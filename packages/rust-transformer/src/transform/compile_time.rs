use std::{borrow::Cow, iter::chain};

use crate::{CompileTimeTransformOptions, OxcTransformResult, quote_expr, quote_stmt};
use oxc_allocator::{Allocator, Box, CloneIn, StringBuilder, TakeIn, Vec};
use oxc_ast::{
  AstBuilder, AstKind, NONE,
  ast::{
    Argument, BindingPattern, ChainElement, ClassType, Expression, FunctionType,
    IdentifierReference, ImportDeclaration, ImportDeclarationSpecifier, ImportOrExportKind,
    Statement, TSModuleDeclarationName, TaggedTemplateExpression, TemplateElement,
    VariableDeclarator,
  },
};
use oxc_ast_visit::{Visit, VisitMut, walk_mut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_index::{IndexBox, IndexSlice, IndexVec};
use oxc_parser::Parser;
use oxc_semantic::{AstNodes, Scoping, SemanticBuilder};
use oxc_sourcemap::SourceMapBuilder;
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::{
  operator::{BinaryOperator, UnaryOperator},
  scope::{ScopeFlags, ScopeId},
  symbol::{SymbolFlags, SymbolId},
};
use rolldown_sourcemap::{SourceMap, collapse_sourcemaps};

use super::shared::CssImportSymbols;

const CSSLIT_EVAL_RESULT_NAME: &str = "__csslit_eval_result";
const CSSLIT_RUNTIME_NAME: &str = "__csslit_eval_runtime";
const CSSLIT_STATE_NAME: &str = "__csslit";

struct ResolvedLocation {
  line: u32,
  column: u32,
  end_line: u32,
  end_column: u32,
}

#[derive(Clone, Copy)]
enum PredicateCode {
  RuntimeParameter,
  FunctionBinding,
  ClassBinding,
  CatchBinding,
  Reassigned,
  Destructured,
  DefaultedBindingPattern,
  UnknownBindingPattern,
  LoopBinding,
  NoInitializer,
  EnumDeclaration,
  EnumMember,
  NamespaceDeclaration,
  UnknownLocalBindingKind,
  NotValueBinding,
  NotExtractedScope,
  Unsupported,
}

impl PredicateCode {
  fn as_code(self) -> &'static str {
    match self {
      Self::RuntimeParameter => "runtime-parameter",
      Self::FunctionBinding => "function-binding",
      Self::ClassBinding => "class-binding",
      Self::CatchBinding => "catch-binding",
      Self::Reassigned => "reassigned",
      Self::Destructured => "destructured",
      Self::DefaultedBindingPattern => "defaulted-binding-pattern",
      Self::UnknownBindingPattern => "unknown-binding-pattern",
      Self::LoopBinding => "loop-binding",
      Self::NoInitializer => "no-initializer",
      Self::EnumDeclaration => "enum-declaration",
      Self::EnumMember => "enum-member",
      Self::NamespaceDeclaration => "namespace-declaration",
      Self::UnknownLocalBindingKind => "unknown-local-binding-kind",
      Self::NotValueBinding => "not-value-binding",
      Self::NotExtractedScope => "not-extracted-scope",
      Self::Unsupported => "unsupported",
    }
  }
}

#[derive(Clone, Copy)]
enum ExpressionCode {
  DeleteExpression,
  CallExpression,
  PrivateField,
  ArrayExpression,
  ArrowFunction,
  AssignmentExpression,
  AwaitExpression,
  ClassExpression,
  FunctionExpression,
  ImportExpression,
  NewExpression,
  ObjectExpression,
  SequenceExpression,
  TaggedTemplate,
  UpdateExpression,
  YieldExpression,
  PrivateInExpression,
  Jsx,
  UnsupportedExpression,
}

impl ExpressionCode {
  fn as_code(self) -> &'static str {
    match self {
      Self::DeleteExpression => "delete-expression",
      Self::CallExpression => "call-expression",
      Self::PrivateField => "private-field",
      Self::ArrayExpression => "array-expression",
      Self::ArrowFunction => "arrow-function",
      Self::AssignmentExpression => "assignment-expression",
      Self::AwaitExpression => "await-expression",
      Self::ClassExpression => "class-expression",
      Self::FunctionExpression => "function-expression",
      Self::ImportExpression => "import-expression",
      Self::NewExpression => "new-expression",
      Self::ObjectExpression => "object-expression",
      Self::SequenceExpression => "sequence-expression",
      Self::TaggedTemplate => "tagged-template",
      Self::UpdateExpression => "update-expression",
      Self::YieldExpression => "yield-expression",
      Self::PrivateInExpression => "private-in-expression",
      Self::Jsx => "jsx",
      Self::UnsupportedExpression => "unsupported-expression",
    }
  }
}

#[derive(Clone, Copy)]
enum Issue<'alloc> {
  Variable {
    name: &'alloc str,
    predicate: PredicateCode,
    span: Span,
  },
  Expression {
    code: ExpressionCode,
    span: Span,
  },
}

impl Issue<'_> {
  fn span(self) -> Span {
    match self {
      Self::Variable { span, .. } | Self::Expression { span, .. } => span,
    }
  }
}

fn variable_issue<'alloc>(
  name: &'alloc str,
  predicate: PredicateCode,
  span: Span,
) -> Issue<'alloc> {
  Issue::Variable {
    name,
    predicate,
    span,
  }
}

fn symbol_issue<'alloc>(
  allocator: &'alloc Allocator,
  scoping: &Scoping,
  symbol_id: SymbolId,
  predicate: PredicateCode,
  span: Span,
) -> Issue<'alloc> {
  variable_issue(
    scoping.symbol_name(symbol_id).clone_in(allocator),
    predicate,
    span,
  )
}

struct SourceLocationContext<'alloc> {
  source_rope: Rope,
  source_text: &'alloc str,
}

impl<'alloc> SourceLocationContext<'alloc> {
  fn new(source_text: &'alloc str) -> Self {
    Self {
      source_rope: Rope::from_str(source_text),
      source_text,
    }
  }

  fn resolve(&self, span: Span) -> ResolvedLocation {
    let (line, column) = get_line_column(&self.source_rope, span.start, self.source_text);
    let (end_line, end_column) = get_line_column(&self.source_rope, span.end, self.source_text);

    ResolvedLocation {
      line,
      column,
      end_line,
      end_column,
    }
  }
}

struct CssSourcemapBuilder {
  builder: SourceMapBuilder,
  source_id: u32,
}

impl CssSourcemapBuilder {
  fn new(allocator: &Allocator, source_text: &str, filename: &str) -> Self {
    let mut builder = SourceMapBuilder::default();
    let mut output_filename = StringBuilder::with_capacity_in(filename.len() + 18, allocator);
    output_filename.push_str(filename);
    output_filename.push_str(".csslit.module.css");
    builder.set_file(output_filename.as_str());
    let source_id = builder.add_source_and_content(filename, source_text);

    Self { builder, source_id }
  }

  fn add_token(&mut self, dst_line: u32, dst_col: u32, source: ResolvedLocation) {
    self.builder.add_token(
      dst_line,
      dst_col,
      source.line,
      source.column,
      Some(self.source_id),
      None,
    );
  }

  fn into_sourcemap(self) -> SourceMap {
    self.builder.into_sourcemap()
  }
}

enum SymbolState<'alloc> {
  Unseen,
  Resolving,
  Import,
  AllowedDirect,
  AllowedThunk,
  AllowedCallMemo { decl_span: Span },
  RejectedThunk(Box<'alloc, RejectedInfo<'alloc>>),
  RejectedCallMemo(Box<'alloc, RejectedInfo<'alloc>>),
}

struct RejectedInfo<'alloc> {
  decl_span: Option<Span>,
  issue: Issue<'alloc>,
}

#[derive(Clone, Copy)]
enum ExpressionAnalysisMode {
  Binding,
  Interpolation,
}

fn mark_symbol_live<'alloc>(
  allocator: &'alloc Allocator,
  css_import_symbols: &CssImportSymbols<'alloc>,
  nodes: &AstNodes,
  scoping: &Scoping,
  symbol_states: &mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
  symbol_id: SymbolId,
) {
  if !matches!(symbol_states[symbol_id], SymbolState::Unseen) {
    return;
  }

  let flags = scoping.symbol_flags(symbol_id);
  if flags.is_import() {
    symbol_states[symbol_id] = SymbolState::Import;
    return;
  }

  symbol_states[symbol_id] = SymbolState::Resolving;
  let state = build_symbol_state(
    allocator,
    css_import_symbols,
    nodes,
    scoping,
    symbol_states,
    symbol_id,
  );

  if matches!(symbol_states[symbol_id], SymbolState::Resolving) {
    symbol_states[symbol_id] = state;
  }
}

fn build_symbol_state<'alloc>(
  allocator: &'alloc Allocator,
  css_import_symbols: &CssImportSymbols<'alloc>,
  nodes: &AstNodes,
  scoping: &Scoping,
  symbol_states: &mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
  symbol_id: SymbolId,
) -> SymbolState<'alloc> {
  let flags = scoping.symbol_flags(symbol_id);

  if flags.is_function() {
    return make_rejected_state(
      allocator,
      false,
      None,
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::FunctionBinding,
        non_declarator_binding_span(nodes, scoping, symbol_id, flags),
      ),
    );
  }

  if flags.is_class() {
    return make_rejected_state(
      allocator,
      false,
      None,
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::ClassBinding,
        non_declarator_binding_span(nodes, scoping, symbol_id, flags),
      ),
    );
  }

  if flags.is_catch_variable() {
    let span = symbol_span(nodes, scoping, symbol_id);
    return make_rejected_state(
      allocator,
      false,
      None,
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::CatchBinding,
        span,
      ),
    );
  }

  if scoping.symbol_is_mutated(symbol_id) {
    let span = symbol_span(nodes, scoping, symbol_id);
    let rejected_span = symbol_write_span(nodes, scoping, symbol_id).unwrap_or(span);
    return make_rejected_state(
      allocator,
      false,
      None,
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::Reassigned,
        rejected_span,
      ),
    );
  }

  let Some(variable_declarator) = find_variable_declarator(nodes, scoping, symbol_id) else {
    let predicate = if flags.is_function_scoped_declaration() {
      PredicateCode::RuntimeParameter
    } else {
      get_non_declarator_binding_predicate(flags)
    };

    return make_rejected_state(
      allocator,
      false,
      None,
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        predicate,
        non_declarator_binding_span(nodes, scoping, symbol_id, flags),
      ),
    );
  };

  let declarator_span = variable_declarator.span;
  let is_var = variable_declarator.kind.is_var();

  if variable_declarator.id.is_destructuring_pattern() {
    return make_rejected_state(
      allocator,
      is_var,
      Some(declarator_span),
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::Destructured,
        declarator_span,
      ),
    );
  }

  if !variable_declarator.id.is_binding_identifier() {
    let predicate = if variable_declarator.id.is_assignment_pattern() {
      PredicateCode::DefaultedBindingPattern
    } else {
      PredicateCode::UnknownBindingPattern
    };

    return make_rejected_state(
      allocator,
      is_var,
      Some(declarator_span),
      symbol_issue(allocator, scoping, symbol_id, predicate, declarator_span),
    );
  }

  if is_loop_declarator(nodes, variable_declarator) {
    return make_rejected_state(
      allocator,
      is_var,
      Some(declarator_span),
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::LoopBinding,
        declarator_span,
      ),
    );
  }

  let Some(init) = variable_declarator.init.as_ref() else {
    return make_rejected_state(
      allocator,
      is_var,
      Some(declarator_span),
      symbol_issue(
        allocator,
        scoping,
        symbol_id,
        PredicateCode::NoInitializer,
        declarator_span,
      ),
    );
  };

  let is_plain = match analyze_binding_expression(
    allocator,
    css_import_symbols,
    nodes,
    scoping,
    symbol_states,
    init,
  ) {
    Ok(is_plain) => is_plain,
    Err(issue) => {
      return make_rejected_state(allocator, is_var, Some(declarator_span), issue);
    }
  };

  if is_var {
    return SymbolState::AllowedCallMemo {
      decl_span: declarator_span,
    };
  }

  if is_plain {
    SymbolState::AllowedDirect
  } else {
    SymbolState::AllowedThunk
  }
}

fn analyze_binding_expression<'alloc>(
  allocator: &'alloc Allocator,
  css_import_symbols: &CssImportSymbols<'alloc>,
  nodes: &AstNodes,
  scoping: &Scoping,
  symbol_states: &mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
  expr: &Expression,
) -> Result<bool, Issue<'alloc>> {
  analyze_supported_expression(
    expr,
    ExpressionAnalysisMode::Binding,
    css_import_symbols,
    &mut |ident| {
      let Some((symbol_id, _)) = referenced_value_symbol_id(allocator, scoping, ident)? else {
        return Ok(false);
      };

      mark_symbol_live(
        allocator,
        css_import_symbols,
        nodes,
        scoping,
        symbol_states,
        symbol_id,
      );
      Ok(matches!(
        symbol_states[symbol_id],
        SymbolState::AllowedDirect
      ))
    },
    scoping,
  )
}

fn analyze_interpolation_expression<'alloc>(
  allocator: &'alloc Allocator,
  css_import_symbols: &CssImportSymbols<'alloc>,
  nodes: &AstNodes,
  scoping: &Scoping,
  symbol_states: &mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
  expr: &Expression,
) -> Result<bool, Issue<'alloc>> {
  analyze_supported_expression(
    expr,
    ExpressionAnalysisMode::Interpolation,
    css_import_symbols,
    &mut |ident| {
      let Some((symbol_id, _)) = referenced_value_symbol_id(allocator, scoping, ident)? else {
        return Ok(false);
      };

      mark_symbol_live(
        allocator,
        css_import_symbols,
        nodes,
        scoping,
        symbol_states,
        symbol_id,
      );
      Ok(matches!(
        symbol_states[symbol_id],
        SymbolState::AllowedDirect
      ))
    },
    scoping,
  )
}

fn referenced_symbol_id(scoping: &Scoping, ident: &IdentifierReference) -> Option<SymbolId> {
  ident
    .reference_id
    .get()
    .and_then(|reference_id| scoping.get_reference(reference_id).symbol_id())
}

fn referenced_value_symbol_id<'alloc>(
  allocator: &'alloc Allocator,
  scoping: &Scoping,
  ident: &IdentifierReference,
) -> Result<Option<(SymbolId, SymbolFlags)>, Issue<'alloc>> {
  let Some(symbol_id) = referenced_symbol_id(scoping, ident) else {
    return Ok(None);
  };

  let flags = scoping.symbol_flags(symbol_id);
  if !flags.is_value() {
    return Err(variable_issue(
      ident.name.as_str().clone_in(allocator),
      PredicateCode::NotValueBinding,
      ident.span,
    ));
  }

  Ok(Some((symbol_id, flags)))
}

fn make_rejected_state<'alloc>(
  allocator: &'alloc Allocator,
  is_call_memo: bool,
  decl_span: Option<Span>,
  issue: Issue<'alloc>,
) -> SymbolState<'alloc> {
  let info = Box::new_in(RejectedInfo { decl_span, issue }, allocator);

  if is_call_memo {
    SymbolState::RejectedCallMemo(info)
  } else {
    SymbolState::RejectedThunk(info)
  }
}

fn find_variable_declarator<'ast>(
  nodes: &AstNodes<'ast>,
  scoping: &Scoping,
  symbol_id: SymbolId,
) -> Option<&'ast VariableDeclarator<'ast>> {
  let declaration_node_id = scoping.symbol_declaration(symbol_id);

  if let AstKind::VariableDeclarator(declarator) = nodes.get_node(declaration_node_id).kind() {
    return Some(declarator);
  }

  for ancestor_id in nodes.ancestor_ids(declaration_node_id) {
    if let AstKind::VariableDeclarator(declarator) = nodes.get_node(ancestor_id).kind() {
      return Some(declarator);
    }
  }

  None
}

fn is_loop_declarator(nodes: &AstNodes, declarator: &VariableDeclarator) -> bool {
  let parent_id = nodes.parent_id(declarator.node_id.get());
  let grandparent_id = nodes.parent_id(parent_id);

  matches!(
    nodes.get_node(grandparent_id).kind(),
    AstKind::ForStatement(_) | AstKind::ForInStatement(_) | AstKind::ForOfStatement(_)
  )
}

fn symbol_span(nodes: &AstNodes, scoping: &Scoping, symbol_id: SymbolId) -> Span {
  nodes
    .get_node(scoping.symbol_declaration(symbol_id))
    .kind()
    .span()
}

fn symbol_write_span(nodes: &AstNodes, scoping: &Scoping, symbol_id: SymbolId) -> Option<Span> {
  scoping
    .get_resolved_references(symbol_id)
    .find(|reference| reference.is_write())
    .map(|reference| nodes.get_node(reference.node_id()).kind().span())
}

fn non_declarator_binding_span(
  nodes: &AstNodes,
  scoping: &Scoping,
  symbol_id: SymbolId,
  flags: SymbolFlags,
) -> Span {
  let declaration_node = nodes.get_node(scoping.symbol_declaration(symbol_id));

  if flags.is_function()
    && let AstKind::Function(declaration) = declaration_node.kind()
    && let Some(identifier) = &declaration.id
  {
    return identifier.span;
  }

  if flags.is_class()
    && let AstKind::Class(declaration) = declaration_node.kind()
    && let Some(identifier) = &declaration.id
  {
    return identifier.span;
  }

  if flags.is_enum()
    && let AstKind::TSEnumDeclaration(declaration) = declaration_node.kind()
  {
    return declaration.id.span;
  }

  if flags.is_value_module()
    && let AstKind::TSModuleDeclaration(declaration) = declaration_node.kind()
    && let TSModuleDeclarationName::Identifier(identifier) = &declaration.id
  {
    return identifier.span;
  }

  declaration_node.kind().span()
}

fn get_non_declarator_binding_predicate(flags: SymbolFlags) -> PredicateCode {
  if flags.is_enum() {
    return PredicateCode::EnumDeclaration;
  }

  if flags.is_enum_member() {
    return PredicateCode::EnumMember;
  }

  if flags.is_value_module() {
    return PredicateCode::NamespaceDeclaration;
  }

  PredicateCode::UnknownLocalBindingKind
}

fn build_issue_expression<'alloc>(
  allocator: &'alloc Allocator,
  issue: Issue<'alloc>,
) -> Expression<'alloc> {
  let span = issue.span();
  match issue {
    Issue::Variable {
      name, predicate, ..
    } => {
      let predicate_text = predicate.as_code();
      quote_expr!(allocator, span, ({ kind: "variable", name: @{name}, predicate: @{predicate_text} }))
    }
    Issue::Expression { code, .. } => {
      let code_text = code.as_code();
      quote_expr!(allocator, span, ({ kind: "expression", code: @{code_text} }))
    }
  }
}

struct TemplateDiscoveryVisitor<'ast, 'alloc> {
  allocator: &'alloc Allocator,
  css_import_symbols: &'ast CssImportSymbols<'alloc>,
  nodes: &'ast AstNodes<'ast>,
  scoping: &'ast Scoping,
  symbol_states: &'ast mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
}

impl<'ast, 'alloc> Visit<'ast> for TemplateDiscoveryVisitor<'ast, 'alloc> {
  fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'ast>) {
    if self
      .css_import_symbols
      .is_css_with_scoping(&it.tag, self.scoping)
    {
      for expression in &it.quasi.expressions {
        if analyze_interpolation_expression(
          self.allocator,
          self.css_import_symbols,
          self.nodes,
          self.scoping,
          self.symbol_states,
          expression,
        )
        .is_err()
        {
          continue;
        }
      }
    }

    oxc_ast_visit::walk::walk_tagged_template_expression(self, it);
  }
}

struct EmitFrame<'ast> {
  body: Vec<'ast, Statement<'ast>>,
  has_live_bindings: bool,
  flags: ScopeFlags,
}

struct CssSourcemapState {
  current_line: u32,
  builder: CssSourcemapBuilder,
}

struct CompileTimeEmitter<'ast, 'alloc> {
  allocator: &'alloc Allocator,
  css_sourcemap_state: Option<CssSourcemapState>,
  css_import_symbols: &'ast CssImportSymbols<'alloc>,
  frames: Vec<'ast, EmitFrame<'ast>>,
  location_context: &'ast SourceLocationContext<'ast>,
  root_body: Vec<'ast, Statement<'ast>>,
  scoping: &'ast Scoping,
  symbol_states: &'ast IndexSlice<SymbolId, [SymbolState<'alloc>]>,
}

impl<'ast, 'alloc> CompileTimeEmitter<'ast, 'alloc> {
  fn record_template_sourcemap(&mut self, quasis: &[TemplateElement<'ast>]) {
    let Some(state) = self.css_sourcemap_state.as_mut() else {
      return;
    };

    let location_context = self.location_context;

    let start_loc = location_context.resolve(quasis.first().unwrap().span);
    state.builder.add_token(state.current_line, 0, start_loc);

    state.current_line += 1;

    for quasi in quasis {
      let raw = quasi.value.raw;
      let cooked = quasi.value.cooked.unwrap_or(raw);
      let generated_line_count = cooked.lines().count() as u32;
      let source_line_count = raw.lines().count() as u32;

      if !cooked.is_empty() {
        let quasi_loc = location_context.resolve(quasi.span);
        for line_offset in 0..generated_line_count {
          state.builder.add_token(
            state.current_line + line_offset,
            0,
            ResolvedLocation {
              line: quasi_loc.line + line_offset.min(source_line_count - 1),
              column: if line_offset == 0 {
                quasi_loc.column
              } else {
                0
              },
              end_line: quasi_loc.end_line,
              end_column: quasi_loc.end_column,
            },
          );
        }

        state.current_line += generated_line_count - 1;
      }
    }

    state.current_line += 2;
  }

  fn finish_css_sourcemap(&mut self) -> Option<SourceMap> {
    self
      .css_sourcemap_state
      .take()
      .map(|state| state.builder.into_sourcemap())
  }

  fn push_binding_statement(&mut self, statement: Statement<'ast>) {
    let frame = self.frames.last_mut().unwrap();
    frame.has_live_bindings = true;
    frame.body.push(statement);
  }

  fn insert_binding_statement(&mut self, index: usize, statement: Statement<'ast>) {
    let frame = self.frames.last_mut().unwrap();
    frame.has_live_bindings = true;
    frame.body.insert(index, statement);
  }

  fn emit_import_declaration(&mut self, mut import: ImportDeclaration<'ast>) {
    if matches!(import.import_kind, ImportOrExportKind::Type) {
      return;
    }

    if let Some(specifiers) = import.specifiers.as_mut() {
      specifiers.retain(|specifier| {
        let symbol_id = match &specifier {
          ImportDeclarationSpecifier::ImportSpecifier(specifier) => specifier.local.symbol_id(),
          ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
            specifier.local.symbol_id()
          }
          ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
            specifier.local.symbol_id()
          }
        };

        matches!(self.symbol_states[symbol_id], SymbolState::Import)
      });

      if specifiers.is_empty() {
        return;
      }
    }

    self.push_binding_statement(Statement::ImportDeclaration(Box::new_in(
      import,
      self.allocator,
    )));
  }

  fn emit_binding_pattern(&mut self, pattern: &BindingPattern<'ast>) {
    match pattern {
      BindingPattern::BindingIdentifier(identifier) => {
        let symbol_id = identifier.symbol_id();
        if matches!(
          self.symbol_states[symbol_id],
          SymbolState::Unseen | SymbolState::Resolving
        ) {
          return;
        }

        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
      BindingPattern::ObjectPattern(pattern) => {
        for property in &pattern.properties {
          self.emit_binding_pattern(&property.value);
        }
        if let Some(rest) = &pattern.rest {
          self.emit_binding_pattern(&rest.argument);
        }
      }
      BindingPattern::ArrayPattern(pattern) => {
        for element in pattern.elements.iter().flatten() {
          self.emit_binding_pattern(element);
        }
        if let Some(rest) = &pattern.rest {
          self.emit_binding_pattern(&rest.argument);
        }
      }
      BindingPattern::AssignmentPattern(pattern) => {
        self.emit_binding_pattern(&pattern.left);
      }
    }
  }

  fn build_owned_symbol_statement(
    &self,
    symbol_id: SymbolId,
    mut init: Expression<'ast>,
  ) -> Statement<'ast> {
    let name = self.scoping.symbol_name(symbol_id);

    match &self.symbol_states[symbol_id] {
      SymbolState::AllowedDirect => {
        rewrite_local_references(
          self.allocator,
          &mut init,
          self.location_context,
          self.scoping,
          self.symbol_states,
        );
        quote_stmt!(self.allocator, const @{name} = (@{init});)
      }
      state @ (SymbolState::AllowedThunk | SymbolState::AllowedCallMemo { .. }) => {
        let init_span = init.span();
        rewrite_local_references(
          self.allocator,
          &mut init,
          self.location_context,
          self.scoping,
          self.symbol_states,
        );
        let arrow = quote_expr!(self.allocator, init_span, () => @{init});
        let location =
          build_runtime_location_expression(self.allocator, init_span, self.location_context);
        let expression =
          quote_expr!(self.allocator, init_span, __csslit.memo(@{name}, @{location}, @{arrow}));

        if matches!(state, SymbolState::AllowedCallMemo { .. }) {
          quote_stmt!(self.allocator, var @{name} = (@{expression});)
        } else {
          quote_stmt!(self.allocator, const @{name} = (@{expression});)
        }
      }
      _ => unreachable!(),
    }
  }

  fn build_non_owned_symbol_statement(&self, symbol_id: SymbolId) -> Statement<'ast> {
    let name = self.scoping.symbol_name(symbol_id);

    match &self.symbol_states[symbol_id] {
      state @ (SymbolState::RejectedThunk(info) | SymbolState::RejectedCallMemo(info)) => {
        let span = info.issue.span();
        let issue_expr = build_issue_expression(self.allocator, info.issue);
        let location_expr =
          build_runtime_location_expression(self.allocator, span, self.location_context);
        let expression = quote_expr!(
          self.allocator,
          span,
          __csslit.memoErr(@{name}, @{issue_expr}, @{location_expr})
        );

        if matches!(state, SymbolState::RejectedCallMemo(_)) {
          quote_stmt!(self.allocator, var @{name} = (@{expression});)
        } else {
          quote_stmt!(self.allocator, const @{name} = (@{expression});)
        }
      }
      SymbolState::AllowedDirect
      | SymbolState::AllowedThunk
      | SymbolState::AllowedCallMemo { .. }
      | SymbolState::Import
      | SymbolState::Unseen
      | SymbolState::Resolving => unreachable!(),
    }
  }

  fn build_function_placeholder_statement(
    &self,
    mut function: oxc_ast::ast::Function<'ast>,
  ) -> Statement<'ast> {
    let identifier = function.id.as_ref().unwrap();
    let name = identifier.name;
    let span = identifier.span;
    let issue_expr = build_issue_expression(
      self.allocator,
      variable_issue(
        name.as_str().clone_in(self.allocator),
        PredicateCode::FunctionBinding,
        span,
      ),
    );
    let use_location_expr = quote_expr!(self.allocator, span, arguments[0]);
    let location_expr =
      build_runtime_location_expression(self.allocator, span, self.location_context);
    let err_expr = quote_expr!(
      self.allocator,
      span,
      __csslit.err(@{issue_expr}, @{use_location_expr}, @{location_expr})
    );
    let return_statement = quote_stmt!(self.allocator, span, return (@{err_expr}););

    if let Some(body) = function.body.as_mut() {
      body.directives.clear();
      body.statements.clear();
      body.statements.push(return_statement);
    }

    Statement::FunctionDeclaration(Box::new_in(function, self.allocator))
  }
}

impl<'ast, 'alloc> VisitMut<'ast> for CompileTimeEmitter<'ast, 'alloc> {
  fn enter_scope(&mut self, flags: ScopeFlags, _scope_id: &std::cell::Cell<Option<ScopeId>>) {
    let mut body = Vec::new_in(self.allocator);
    if self.frames.is_empty() {
      body.push(quote_stmt!(
        self.allocator,
        import * as @{CSSLIT_RUNTIME_NAME} from @"virtual:csslit-eval-runtime";
      ));
      let state_init = quote_expr!(self.allocator, __csslit_eval_runtime.init());
      body.push(quote_stmt!(self.allocator, const @{CSSLIT_STATE_NAME} = (@{state_init});));
    }

    self.frames.push(EmitFrame {
      body,
      has_live_bindings: false,
      flags,
    });
  }

  fn leave_scope(&mut self) {
    let frame = self.frames.pop().unwrap();

    let Some(parent) = self.frames.last_mut() else {
      self.root_body = frame.body;
      return;
    };

    if frame.body.is_empty() {
      return;
    }

    if frame.flags.is_function() || frame.flags.is_arrow() || frame.flags.is_class_static_block() {
      let body = frame.body;
      let task = quote_expr!(self.allocator, () => { @{body} });
      parent
        .body
        .push(quote_stmt!(self.allocator, (__csslit.defer(@{task}));));
      return;
    }

    if frame.has_live_bindings {
      let body = frame.body;
      parent.body.push(quote_stmt!(self.allocator, { @{body} }));
      return;
    }

    parent.body.extend(frame.body);
  }

  fn visit_import_declaration(&mut self, import: &mut ImportDeclaration<'ast>) {
    self.emit_import_declaration(import.take_in(self.allocator));
  }

  fn visit_tagged_template_expression(&mut self, tagged: &mut TaggedTemplateExpression<'ast>) {
    if !self
      .css_import_symbols
      .is_css_with_scoping(&tagged.tag, self.scoping)
    {
      walk_mut::walk_tagged_template_expression(self, tagged);
      return;
    }

    self.record_template_sourcemap(&tagged.quasi.quasis);
    let mut template = tagged.quasi.take_in(self.allocator);
    for expression in &mut template.expressions {
      let span = expression.span();
      let mut rewritten_expression = expression.take_in(self.allocator);
      let should_capture = match analyze_expression_for_synthesis(
        self.allocator,
        self.css_import_symbols,
        &rewritten_expression,
        self.scoping,
        self.symbol_states,
      ) {
        Ok(is_plain) => {
          rewrite_local_references(
            self.allocator,
            &mut rewritten_expression,
            self.location_context,
            self.scoping,
            self.symbol_states,
          );
          !is_plain
        }
        Err(issue) => {
          let span = issue.span();
          let issue_expr = build_issue_expression(self.allocator, issue);

          let location_expr =
            build_runtime_location_expression(self.allocator, span, self.location_context);
          let expression =
            quote_expr!(self.allocator, span, __csslit.err(@{issue_expr}, @{location_expr}));

          rewritten_expression = expression;
          true
        }
      };

      *expression = if should_capture {
        let arrow = quote_expr!(self.allocator, span, () => @{rewritten_expression});
        let location =
          build_runtime_location_expression(self.allocator, span, self.location_context);
        quote_expr!(self.allocator, span, __csslit.capture(@{location}, @{arrow}))
      } else {
        rewritten_expression
      };
    }

    let mut current_line = 1u32;
    let mut patch_lines = Vec::with_capacity_in(template.expressions.len(), self.allocator);
    for (index, quasi) in template.quasis.iter().enumerate() {
      let raw = quasi.value.raw;
      let cooked = quasi.value.cooked.unwrap_or(raw);
      let generated_line_count = cooked.lines().count() as u32;

      if !cooked.is_empty() {
        current_line += generated_line_count - 1;
      }

      if index < template.expressions.len() {
        patch_lines.push(current_line);
      }
    }
    let span = template.span;
    let callee = quote_expr!(self.allocator, span, __csslit.css({ patch_lines: [@{patch_lines}] }));
    let css_eval =
      AstBuilder::new(self.allocator).expression_tagged_template(span, callee, NONE, template);
    let statement = quote_stmt!(self.allocator, (@{css_eval}););
    self.frames.last_mut().unwrap().body.push(statement);
  }

  fn visit_variable_declarator(&mut self, declarator: &mut VariableDeclarator<'ast>) {
    if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
      let symbol_id = identifier.symbol_id();
      if matches!(
        self.symbol_states[symbol_id],
        SymbolState::AllowedDirect
          | SymbolState::AllowedThunk
          | SymbolState::AllowedCallMemo { .. }
      ) {
        let init = declarator
          .init
          .take()
          .expect("live simple bindings must have an initializer");
        self.push_binding_statement(self.build_owned_symbol_statement(symbol_id, init));
        return;
      }
    }

    self.emit_binding_pattern(&declarator.id);
    walk_mut::walk_variable_declarator(self, declarator);
  }

  fn visit_formal_parameter(&mut self, parameter: &mut oxc_ast::ast::FormalParameter<'ast>) {
    self.emit_binding_pattern(&parameter.pattern);
    walk_mut::walk_formal_parameter(self, parameter);
  }

  fn visit_catch_parameter(&mut self, parameter: &mut oxc_ast::ast::CatchParameter<'ast>) {
    self.emit_binding_pattern(&parameter.pattern);
    walk_mut::walk_catch_parameter(self, parameter);
  }

  fn visit_ts_enum_declaration(&mut self, declaration: &mut oxc_ast::ast::TSEnumDeclaration<'ast>) {
    let symbol_id = declaration.id.symbol_id();
    if !matches!(
      self.symbol_states[symbol_id],
      SymbolState::Unseen | SymbolState::Resolving
    ) {
      self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
    }
    walk_mut::walk_ts_enum_declaration(self, declaration);
  }

  fn visit_ts_module_declaration(
    &mut self,
    declaration: &mut oxc_ast::ast::TSModuleDeclaration<'ast>,
  ) {
    if let TSModuleDeclarationName::Identifier(identifier) = &declaration.id {
      let symbol_id = identifier.symbol_id();
      if !matches!(
        self.symbol_states[symbol_id],
        SymbolState::Unseen | SymbolState::Resolving
      ) {
        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
    }
    walk_mut::walk_ts_module_declaration(self, declaration);
  }

  fn visit_function(&mut self, function: &mut oxc_ast::ast::Function<'ast>, flags: ScopeFlags) {
    let binding_index = self.frames.last().unwrap().body.len();
    let should_emit_placeholder = matches!(function.r#type, FunctionType::FunctionDeclaration)
      && function.id.as_ref().is_some_and(|identifier| {
        !matches!(
          self.symbol_states[identifier.symbol_id()],
          SymbolState::Unseen | SymbolState::Resolving
        )
      });

    let mut function = function.take_in(self.allocator);
    walk_mut::walk_function(self, &mut function, flags);

    if should_emit_placeholder {
      let placeholder = self.build_function_placeholder_statement(function);
      self.insert_binding_statement(binding_index, placeholder);
    }
  }

  fn visit_class(&mut self, class: &mut oxc_ast::ast::Class<'ast>) {
    if matches!(class.r#type, ClassType::ClassDeclaration)
      && let Some(identifier) = &class.id
    {
      let symbol_id = identifier.symbol_id();
      if !matches!(
        self.symbol_states[symbol_id],
        SymbolState::Unseen | SymbolState::Resolving
      ) {
        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
    }
    walk_mut::walk_class(self, class);
  }
}

pub(super) fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformOptions,
) -> OxcTransformResult {
  let CompileTimeTransformOptions {
    filename,
    css_filename,
    css_sourcemap,
    sourcemap,
    input_map,
  } = options;

  let source_type = SourceType::from_path(&filename)
    .unwrap()
    .with_typescript(true)
    .with_jsx(true);

  let allocator = &Allocator::default();

  let mut ret = Parser::new(allocator, &source_text, source_type).parse();
  let (scoping, css_import_symbols, symbol_states) = {
    let semantic = SemanticBuilder::new().build(&ret.program).semantic;
    let css_import_symbols = CssImportSymbols::collect(allocator, &ret.program);
    let (scoping, nodes) = semantic.into_scoping_and_nodes();

    let mut symbol_states = IndexVec::with_capacity(scoping.symbols_len());
    symbol_states.resize_with(scoping.symbols_len(), || SymbolState::Unseen);
    let mut symbol_states: IndexBox<SymbolId, [SymbolState]> = symbol_states.into_boxed_slice();

    TemplateDiscoveryVisitor {
      allocator,
      css_import_symbols: &css_import_symbols,
      nodes: &nodes,
      scoping: &scoping,
      symbol_states: &mut symbol_states,
    }
    .visit_program(&ret.program);

    (scoping, css_import_symbols, symbol_states)
  };

  let diagnostic_location_context = SourceLocationContext::new(&source_text);

  let mut emitter = CompileTimeEmitter {
    allocator,
    css_sourcemap_state: css_sourcemap.then(|| CssSourcemapState {
      current_line: 0,
      builder: CssSourcemapBuilder::new(allocator, &source_text, &css_filename),
    }),
    css_import_symbols: &css_import_symbols,
    frames: Vec::new_in(allocator),
    location_context: &diagnostic_location_context,
    root_body: Vec::new_in(allocator),
    scoping: &scoping,
    symbol_states: &symbol_states,
  };
  emitter.visit_program(&mut ret.program);

  fn collapse<'a>(a: Cow<'a, SourceMap>, b: Cow<'a, SourceMap>) -> Cow<'a, SourceMap> {
    Cow::Owned(collapse_sourcemaps(&[&a, &b]))
  }

  let css_baseline_map = emitter.finish_css_sourcemap();

  let baseline_map = match (input_map.as_ref(), css_baseline_map.as_ref()) {
    (Some(a), Some(b)) => {
      let map = collapse_sourcemaps(&[a, b]);
      let json = map.to_json_string();
      quote_expr!(allocator, JSON.parse(@{json}))
    }
    (None, Some(map)) | (Some(map), None) => {
      let json = map.to_json_string();
      quote_expr!(allocator, JSON.parse(@{json}))
    }
    _ => quote_expr!(allocator, null),
  };

  let finalize = quote_expr!(allocator, __csslit.finalize(@{baseline_map}));
  emitter
    .root_body
    .push(quote_stmt!(allocator, export const @{CSSLIT_EVAL_RESULT_NAME} = (@{finalize});));

  let output_program = AstBuilder::new(allocator).program_with_scope_id(
    ret.program.span,
    ret.program.source_type,
    ret.program.source_text,
    ret.program.comments.take_in(allocator),
    ret.program.hashbang.take(),
    ret.program.directives.take_in(allocator),
    emitter.root_body,
    ret.program.scope_id.get().unwrap(),
  );

  let result = Codegen::new()
    .with_options(CodegenOptions {
      source_map_path: sourcemap.then(|| filename.into()),
      ..CodegenOptions::default()
    })
    .with_source_text(&source_text)
    .build(&output_program);

  OxcTransformResult {
    code: result.code,
    map: result.map.map(|transform_map| match input_map.as_ref() {
      Some(input_map) => collapse_sourcemaps(&[input_map, &transform_map]),
      None => transform_map,
    }),
  }
}

fn analyze_expression_for_synthesis<'alloc>(
  allocator: &'alloc Allocator,
  css_import_symbols: &CssImportSymbols<'alloc>,
  expr: &Expression,
  scoping: &Scoping,
  symbol_states: &IndexSlice<SymbolId, [SymbolState<'alloc>]>,
) -> Result<bool, Issue<'alloc>> {
  analyze_supported_expression(
    expr,
    ExpressionAnalysisMode::Interpolation,
    css_import_symbols,
    &mut |ident| {
      let Some((symbol_id, flags)) = referenced_value_symbol_id(allocator, scoping, ident)? else {
        return Ok(false);
      };

      if flags.is_import() {
        return Ok(false);
      }

      if matches!(
        symbol_states[symbol_id],
        SymbolState::Unseen | SymbolState::Resolving
      ) {
        return Err(variable_issue(
          ident.name.as_str().clone_in(allocator),
          PredicateCode::NotExtractedScope,
          ident.span,
        ));
      }

      Ok(matches!(
        symbol_states[symbol_id],
        SymbolState::AllowedDirect
      ))
    },
    scoping,
  )
}

fn analyze_supported_expression<'alloc>(
  expr: &Expression,
  mode: ExpressionAnalysisMode,
  css_import_symbols: &CssImportSymbols<'alloc>,
  on_identifier: &mut impl FnMut(&IdentifierReference) -> Result<bool, Issue<'alloc>>,
  scoping: &Scoping,
) -> Result<bool, Issue<'alloc>> {
  match expr {
    Expression::BooleanLiteral(_)
    | Expression::NullLiteral(_)
    | Expression::NumericLiteral(_)
    | Expression::BigIntLiteral(_)
    | Expression::RegExpLiteral(_)
    | Expression::StringLiteral(_) => Ok(true),
    Expression::MetaProperty(_) | Expression::ThisExpression(_) => Ok(false),
    Expression::Identifier(ident) => on_identifier(ident),
    Expression::TemplateLiteral(template) => {
      let mut is_plain = true;
      for expression in &template.expressions {
        is_plain &= analyze_supported_expression(
          expression,
          mode,
          css_import_symbols,
          on_identifier,
          scoping,
        )?;
      }
      Ok(is_plain)
    }
    Expression::ArrayExpression(array) => match mode {
      ExpressionAnalysisMode::Binding => Err(Issue::Expression {
        code: expression_dependency_code(expr),
        span: expr.span(),
      }),
      ExpressionAnalysisMode::Interpolation => {
        for element in &array.elements {
          match element {
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
              analyze_supported_expression(
                &spread.argument,
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => {}
            _ => {
              analyze_supported_expression(
                element.to_expression(),
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
          }
        }
        Ok(false)
      }
    },
    Expression::ObjectExpression(object) => match mode {
      ExpressionAnalysisMode::Binding => Err(Issue::Expression {
        code: expression_dependency_code(expr),
        span: expr.span(),
      }),
      ExpressionAnalysisMode::Interpolation => {
        for property in &object.properties {
          match property {
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
              if property.computed
                && let Some(expression) = property.key.as_expression()
              {
                analyze_supported_expression(
                  expression,
                  mode,
                  css_import_symbols,
                  on_identifier,
                  scoping,
                )?;
              }
              analyze_supported_expression(
                &property.value,
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(property) => {
              analyze_supported_expression(
                &property.argument,
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
          }
        }
        Ok(false)
      }
    },
    Expression::CallExpression(call)
      if matches!(mode, ExpressionAnalysisMode::Binding)
        && css_import_symbols.is_comptime_with_scoping(&call.callee, scoping) =>
    {
      analyze_supported_expression(
        &call.callee,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;

      if call.arguments.len() != 1 {
        return Err(Issue::Expression {
          code: ExpressionCode::CallExpression,
          span: call.span,
        });
      }

      let argument = &call.arguments[0];
      let expression = match argument {
        Argument::SpreadElement(_) => {
          return Err(Issue::Expression {
            code: ExpressionCode::CallExpression,
            span: argument.span(),
          });
        }
        _ => argument.to_expression(),
      };

      analyze_supported_expression(
        expression,
        ExpressionAnalysisMode::Interpolation,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(false)
    }
    Expression::CallExpression(call) => match mode {
      ExpressionAnalysisMode::Binding => Err(Issue::Expression {
        code: ExpressionCode::CallExpression,
        span: call.span,
      }),
      ExpressionAnalysisMode::Interpolation => {
        analyze_supported_expression(
          &call.callee,
          mode,
          css_import_symbols,
          on_identifier,
          scoping,
        )?;
        for argument in &call.arguments {
          match argument {
            Argument::SpreadElement(spread) => {
              analyze_supported_expression(
                &spread.argument,
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
            _ => {
              analyze_supported_expression(
                argument.to_expression(),
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
          }
        }
        Ok(false)
      }
    },
    Expression::PrivateFieldExpression(member) => Err(Issue::Expression {
      code: ExpressionCode::PrivateField,
      span: member.span,
    }),
    Expression::UnaryExpression(unary) => {
      if unary.operator == UnaryOperator::Delete {
        Err(Issue::Expression {
          code: ExpressionCode::DeleteExpression,
          span: unary.span,
        })
      } else {
        analyze_supported_expression(
          &unary.argument,
          mode,
          css_import_symbols,
          on_identifier,
          scoping,
        )
      }
    }
    Expression::BinaryExpression(binary) => {
      let left_plain = analyze_supported_expression(
        &binary.left,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      let right_plain = analyze_supported_expression(
        &binary.right,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(
        binary.operator != BinaryOperator::In
          && binary.operator != BinaryOperator::Instanceof
          && left_plain
          && right_plain,
      )
    }
    Expression::LogicalExpression(logical) => {
      let left_plain = analyze_supported_expression(
        &logical.left,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      let right_plain = analyze_supported_expression(
        &logical.right,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(left_plain && right_plain)
    }
    Expression::ConditionalExpression(conditional) => {
      let test_plain = analyze_supported_expression(
        &conditional.test,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      let consequent_plain = analyze_supported_expression(
        &conditional.consequent,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      let alternate_plain = analyze_supported_expression(
        &conditional.alternate,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(test_plain && consequent_plain && alternate_plain)
    }
    Expression::ParenthesizedExpression(parenthesized) => analyze_supported_expression(
      &parenthesized.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::ComputedMemberExpression(member) => {
      analyze_supported_expression(
        &member.object,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      analyze_supported_expression(
        &member.expression,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(false)
    }
    Expression::StaticMemberExpression(member) => {
      analyze_supported_expression(
        &member.object,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(false)
    }
    Expression::ChainExpression(chain) => analyze_supported_chain_element(
      &chain.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::TSAsExpression(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::TSSatisfiesExpression(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::TSTypeAssertion(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::TSNonNullExpression(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    Expression::TSInstantiationExpression(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
    _ => Err(Issue::Expression {
      code: expression_dependency_code(expr),
      span: expr.span(),
    }),
  }
}

fn analyze_supported_chain_element<'alloc>(
  chain: &ChainElement,
  mode: ExpressionAnalysisMode,
  css_import_symbols: &CssImportSymbols<'alloc>,
  on_identifier: &mut impl FnMut(&IdentifierReference) -> Result<bool, Issue<'alloc>>,
  scoping: &Scoping,
) -> Result<bool, Issue<'alloc>> {
  match chain {
    ChainElement::CallExpression(call) => match mode {
      ExpressionAnalysisMode::Binding => Err(Issue::Expression {
        code: ExpressionCode::CallExpression,
        span: call.span,
      }),
      ExpressionAnalysisMode::Interpolation => {
        analyze_supported_expression(
          &call.callee,
          mode,
          css_import_symbols,
          on_identifier,
          scoping,
        )?;
        for argument in &call.arguments {
          match argument {
            Argument::SpreadElement(spread) => {
              analyze_supported_expression(
                &spread.argument,
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
            _ => {
              analyze_supported_expression(
                argument.to_expression(),
                mode,
                css_import_symbols,
                on_identifier,
                scoping,
              )?;
            }
          }
        }
        Ok(false)
      }
    },
    ChainElement::ComputedMemberExpression(member) => {
      analyze_supported_expression(
        &member.object,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      analyze_supported_expression(
        &member.expression,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(false)
    }
    ChainElement::StaticMemberExpression(member) => {
      analyze_supported_expression(
        &member.object,
        mode,
        css_import_symbols,
        on_identifier,
        scoping,
      )?;
      Ok(false)
    }
    ChainElement::PrivateFieldExpression(member) => Err(Issue::Expression {
      code: ExpressionCode::PrivateField,
      span: member.span,
    }),
    ChainElement::TSNonNullExpression(expression) => analyze_supported_expression(
      &expression.expression,
      mode,
      css_import_symbols,
      on_identifier,
      scoping,
    ),
  }
}

fn rewrite_local_references<'alloc>(
  allocator: &'alloc Allocator,
  expr: &mut Expression<'alloc>,
  location_context: &SourceLocationContext,
  scoping: &Scoping,
  symbol_states: &IndexSlice<SymbolId, [SymbolState<'alloc>]>,
) {
  match expr {
    Expression::Identifier(ident) => {
      let Some(symbol_id) = referenced_symbol_id(scoping, ident) else {
        return;
      };

      let callee = ident.name;
      *expr = match &symbol_states[symbol_id] {
        SymbolState::AllowedDirect
        | SymbolState::Import
        | SymbolState::Unseen
        | SymbolState::Resolving => return,
        SymbolState::AllowedThunk | SymbolState::RejectedThunk(_) => {
          let location = build_runtime_location_expression(allocator, ident.span, location_context);
          quote_expr!(allocator, @{callee}(@{location}))
        }
        state @ (SymbolState::AllowedCallMemo { .. } | SymbolState::RejectedCallMemo(_)) => {
          let use_span = ident.span;
          let name = ident.name.as_str();
          let init_span = match state {
            SymbolState::AllowedCallMemo { decl_span } => *decl_span,
            SymbolState::RejectedCallMemo(info) => info.decl_span.unwrap(),
            _ => unreachable!(),
          };
          let use_location =
            build_runtime_location_expression(allocator, use_span, location_context);
          let init_location =
            build_runtime_location_expression(allocator, init_span, location_context);
          quote_expr!(
            allocator,
            use_span,
            __csslit.callMemo(@{name}, @{callee}, @{use_location}, @{init_location})
          )
        }
      };
    }
    Expression::TemplateLiteral(template) => {
      for expression in &mut template.expressions {
        rewrite_local_references(
          allocator,
          expression,
          location_context,
          scoping,
          symbol_states,
        );
      }
    }
    Expression::UnaryExpression(unary) => {
      rewrite_local_references(
        allocator,
        &mut unary.argument,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::BinaryExpression(binary) => {
      rewrite_local_references(
        allocator,
        &mut binary.left,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut binary.right,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::LogicalExpression(logical) => {
      rewrite_local_references(
        allocator,
        &mut logical.left,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut logical.right,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::ConditionalExpression(conditional) => {
      rewrite_local_references(
        allocator,
        &mut conditional.test,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut conditional.consequent,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut conditional.alternate,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::ParenthesizedExpression(parenthesized) => {
      rewrite_local_references(
        allocator,
        &mut parenthesized.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::ComputedMemberExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut member.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::StaticMemberExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::ChainExpression(chain) => {
      rewrite_local_chain_references(
        allocator,
        &mut chain.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::ArrayExpression(array) => {
      for element in &mut array.elements {
        match element {
          oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
            rewrite_local_references(
              allocator,
              &mut spread.argument,
              location_context,
              scoping,
              symbol_states,
            );
          }
          oxc_ast::ast::ArrayExpressionElement::Elision(_) => {}
          _ => {
            let expression = element.to_expression_mut();
            rewrite_local_references(
              allocator,
              expression,
              location_context,
              scoping,
              symbol_states,
            );
          }
        }
      }
    }
    Expression::ObjectExpression(object) => {
      for property in &mut object.properties {
        match property {
          oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
            if property.computed
              && let Some(expression) = property.key.as_expression_mut()
            {
              rewrite_local_references(
                allocator,
                expression,
                location_context,
                scoping,
                symbol_states,
              );
            }
            rewrite_local_references(
              allocator,
              &mut property.value,
              location_context,
              scoping,
              symbol_states,
            );
          }
          oxc_ast::ast::ObjectPropertyKind::SpreadProperty(property) => {
            rewrite_local_references(
              allocator,
              &mut property.argument,
              location_context,
              scoping,
              symbol_states,
            );
          }
        }
      }
    }
    Expression::CallExpression(call) => {
      rewrite_local_references(
        allocator,
        &mut call.callee,
        location_context,
        scoping,
        symbol_states,
      );
      for argument in &mut call.arguments {
        match argument {
          Argument::SpreadElement(spread) => {
            rewrite_local_references(
              allocator,
              &mut spread.argument,
              location_context,
              scoping,
              symbol_states,
            );
          }
          _ => {
            let expression = argument.to_expression_mut();
            rewrite_local_references(
              allocator,
              expression,
              location_context,
              scoping,
              symbol_states,
            );
          }
        }
      }
    }
    Expression::PrivateFieldExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::TSAsExpression(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::TSSatisfiesExpression(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::TSTypeAssertion(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::TSNonNullExpression(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    Expression::TSInstantiationExpression(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    _ => {}
  }
}

fn rewrite_local_chain_references<'alloc>(
  allocator: &'alloc Allocator,
  chain: &mut ChainElement<'alloc>,
  location_context: &SourceLocationContext,
  scoping: &Scoping,
  symbol_states: &IndexSlice<SymbolId, [SymbolState<'alloc>]>,
) {
  match chain {
    ChainElement::CallExpression(call) => {
      rewrite_local_references(
        allocator,
        &mut call.callee,
        location_context,
        scoping,
        symbol_states,
      );
      for argument in &mut call.arguments {
        match argument {
          Argument::SpreadElement(spread) => {
            rewrite_local_references(
              allocator,
              &mut spread.argument,
              location_context,
              scoping,
              symbol_states,
            );
          }
          _ => {
            let expression = argument.to_expression_mut();
            rewrite_local_references(
              allocator,
              expression,
              location_context,
              scoping,
              symbol_states,
            );
          }
        }
      }
    }
    ChainElement::ComputedMemberExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
      rewrite_local_references(
        allocator,
        &mut member.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
    ChainElement::StaticMemberExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
    }
    ChainElement::PrivateFieldExpression(member) => {
      rewrite_local_references(
        allocator,
        &mut member.object,
        location_context,
        scoping,
        symbol_states,
      );
    }
    ChainElement::TSNonNullExpression(expression) => {
      rewrite_local_references(
        allocator,
        &mut expression.expression,
        location_context,
        scoping,
        symbol_states,
      );
    }
  }
}

fn build_runtime_location_expression<'alloc>(
  allocator: &'alloc Allocator,
  span: Span,
  location_context: &SourceLocationContext,
) -> Expression<'alloc> {
  let resolved = location_context.resolve(span);
  let line = resolved.line;
  let column = resolved.column;
  let end_line = resolved.end_line;
  let end_column = resolved.end_column;

  quote_expr!(allocator, span, @"{line}:{column}:{end_line}:{end_column}")
}

fn expression_dependency_code(expr: &Expression) -> ExpressionCode {
  match expr {
    Expression::ArrayExpression(_) => ExpressionCode::ArrayExpression,
    Expression::ArrowFunctionExpression(_) => ExpressionCode::ArrowFunction,
    Expression::AssignmentExpression(_) => ExpressionCode::AssignmentExpression,
    Expression::AwaitExpression(_) => ExpressionCode::AwaitExpression,
    Expression::CallExpression(_) => ExpressionCode::CallExpression,
    Expression::ClassExpression(_) => ExpressionCode::ClassExpression,
    Expression::FunctionExpression(_) => ExpressionCode::FunctionExpression,
    Expression::ImportExpression(_) => ExpressionCode::ImportExpression,
    Expression::NewExpression(_) => ExpressionCode::NewExpression,
    Expression::ObjectExpression(_) => ExpressionCode::ObjectExpression,
    Expression::PrivateFieldExpression(_) => ExpressionCode::PrivateField,
    Expression::SequenceExpression(_) => ExpressionCode::SequenceExpression,
    Expression::TaggedTemplateExpression(_) => ExpressionCode::TaggedTemplate,
    Expression::UpdateExpression(_) => ExpressionCode::UpdateExpression,
    Expression::YieldExpression(_) => ExpressionCode::YieldExpression,
    Expression::PrivateInExpression(_) => ExpressionCode::PrivateInExpression,
    Expression::JSXElement(_) | Expression::JSXFragment(_) => ExpressionCode::Jsx,
    _ => ExpressionCode::UnsupportedExpression,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn compile(source: &str) -> String {
    let mut output = transform_compile_time(
      source.to_string(),
      CompileTimeTransformOptions {
        filename: "/src/example.tsx".to_string(),
        css_filename: "/src/example.tsx".to_string(),
        css_sourcemap: false,
        sourcemap: false,
        input_map: None,
      },
    )
    .code
    .replace("\r\n", "\n");

    while output.ends_with('\n') {
      output.pop();
    }

    let mut normalized = output
      .lines()
      .map(|line| {
        let indent_len = line.chars().take_while(|char| char.is_whitespace()).count();
        let (indent, rest) = line.split_at(indent_len);
        format!("{}{rest}", indent.replace('\t', "  "))
      })
      .collect::<std::vec::Vec<_>>()
      .join("\n");

    normalized.push('\n');
    normalized
  }

  fn dedent(raw: &str) -> String {
    let lines = raw.lines().collect::<std::vec::Vec<_>>();
    let start = lines
      .iter()
      .position(|line| !line.trim().is_empty())
      .unwrap_or(lines.len());
    let end = lines
      .iter()
      .rposition(|line| !line.trim().is_empty())
      .map(|index| index + 1)
      .unwrap_or(start);
    let lines = &lines[start..end];
    let indent = lines
      .iter()
      .filter(|line| !line.trim().is_empty())
      .map(|line| line.chars().take_while(|char| char.is_whitespace()).count())
      .min()
      .unwrap_or(0);

    let mut expected = lines
      .iter()
      .map(|line| line.chars().skip(indent).collect::<String>())
      .collect::<std::vec::Vec<_>>()
      .join("\n");
    expected.push('\n');
    expected
  }

  fn assert_snapshot(output: &str, expected: &str) {
    assert_eq!(dedent(expected), output);
  }

  #[test]
  fn snapshots_top_level_binding_rewrite() {
    let output = compile(
      r#"
        import { css } from "csslit";
        import { color, unused } from "./theme";

        const tone = color ?? "red";
        css`color: ${tone}; border-color: ${window.theme.border};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { color } from "./theme";
        const tone = __csslit.memo("tone", "4:21:4:35", () => color ?? "red");
        __csslit.css({ patch_lines: [1, 1] })`color: ${__csslit.capture("5:21:5:25", () => tone("5:21:5:25"))}; border-color: ${__csslit.capture("5:44:5:63", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn snapshots_deferred_scope_and_rejected_param() {
    let output = compile(
      r#"
        import { css } from "csslit";

        const outer = 1;

        function demo(param: string) {
          const local = outer + 1;
          css`width: ${local}px; height: ${param}px;`;
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        const outer = 1;
        __csslit.defer(() => {
          const param = __csslit.memoErr("param", "runtime-parameter", "5:22:5:35");
          const local = outer + 1;
          __csslit.css({ patch_lines: [1, 1] })`width: ${local}px; height: ${__csslit.capture("7:43:7:48", () => param("7:43:7:48"))}px;`;
        });
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn keeps_only_used_imports_and_allows_globals() {
    let output = compile(
      r#"
        import { css } from "csslit";
        import { color, unused } from "./theme";

        const tone = color ?? globalThis.theme.fallback;
        css`color: ${tone}; border-color: ${window.theme.border};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { color } from "./theme";
        const tone = __csslit.memo("tone", "4:21:4:55", () => color ?? globalThis.theme.fallback);
        __csslit.css({ patch_lines: [1, 1] })`color: ${__csslit.capture("5:21:5:25", () => tone("5:21:5:25"))}; border-color: ${__csslit.capture("5:44:5:63", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_mutated_and_destructured_locals() {
    let output = compile(
      r#"
        import { css } from "csslit";
        import { color, theme } from "./theme";

        let tone = color;
        tone = "blue";

        const { border } = theme;
        css`color: ${tone}; border-width: ${border};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        const tone = __csslit.memoErr("tone", "reassigned", "5:8:5:12");
        const border = __csslit.memoErr("border", "destructured", "7:14:7:32");
        __csslit.css({ patch_lines: [1, 1] })`color: ${__csslit.capture("8:21:8:25", () => tone("8:21:8:25"))}; border-width: ${__csslit.capture("8:44:8:50", () => border("8:44:8:50"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_var_bindings_via_call_memo() {
    let output = compile(
      r#"
        import { css } from "csslit";

        var legacy = "red";
        const stable = "1px";

        css`color: ${legacy}; border-width: ${stable};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        var legacy = __csslit.memo("legacy", "3:21:3:26", () => "red");
        const stable = "1px";
        __csslit.css({ patch_lines: [1, 1] })`color: ${__csslit.capture("6:21:6:27", () => __csslit.callMemo("legacy", legacy, "6:21:6:27", "3:12:3:26"))}; border-width: ${stable};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_var_reads_before_initializer_via_call_memo() {
    let output = compile(
      r#"
        import { css } from "csslit";

        css`color: ${legacy};`;
        var legacy = "red";
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css({ patch_lines: [1] })`color: ${__csslit.capture("3:21:3:27", () => __csslit.callMemo("legacy", legacy, "3:21:3:27", "4:12:4:26"))};`;
        var legacy = __csslit.memo("legacy", "4:21:4:26", () => "red");
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_unsupported_interpolations_without_aborting_capture() {
    let output = compile(
      r#"
        import { css } from "csslit";

        const tone = "red";
        css`color: ${tone}; width: ${pickSize()}px; border-color: ${window.theme.border};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        const tone = "red";
        __csslit.css({ patch_lines: [
          1,
          1,
          1
        ] })`color: ${tone}; width: ${__csslit.capture("4:37:4:47", () => pickSize())}px; border-color: ${__csslit.capture("4:68:4:87", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn flattens_non_deferred_scope_without_local_bindings() {
    let output = compile(
      r#"
        import { css } from "csslit";

        {
          css`color: red;`;
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css({ patch_lines: [] })`color: red;`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn function_bindings_throw_via_hoisted_thunks() {
    let output = compile(
      r#"
        import { css } from "csslit";

        css`color: ${pick()};`;

        function pick() {
          return "red";
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css({ patch_lines: [1] })`color: ${__csslit.capture("3:21:3:27", () => pick("3:21:3:25")())};`;
        function pick() {
          return __csslit.err({
            code: "variable",
            name: "pick"
          }, "function-binding", arguments[0], undefined, "5:17:5:21");
        }
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn class_bindings_throw_via_memo_err() {
    let output = compile(
      r#"
        import { css } from "csslit";

        css`color: ${Theme};`;

        class Theme {
          tone = "red";
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css({ patch_lines: [1] })`color: ${__csslit.capture("3:21:3:26", () => Theme("3:21:3:26"))};`;
        const Theme = __csslit.memoErr("Theme", "class-binding", "5:14:5:19");
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }
}
