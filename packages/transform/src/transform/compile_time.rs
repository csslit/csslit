use crate::{
  CompileTimeTransformOptions, OxcTransformResult, bit_set::BitSet, quote_expr, quote_stmt,
};
use oxc_allocator::{Allocator, Box, CloneIn, GetAllocator, TakeIn, Vec};
use oxc_ast::{
  AstKind,
  ast::{
    Argument, ArrayAssignmentTarget, ArrayExpressionElement, ArrowFunctionExpression,
    AssignmentTarget, AssignmentTargetMaybeDefault, AssignmentTargetProperty, AssignmentTargetRest,
    BindingPattern, CatchParameter, ChainElement, Class, ClassType, Expression, FormalParameter,
    Function, FunctionType, IdentifierName, IdentifierReference, ImportDeclaration,
    ImportDeclarationSpecifier, ImportOrExportKind, ObjectAssignmentTarget, ObjectPropertyKind,
    Program, SimpleAssignmentTarget, Statement, StaticMemberExpression, TSEnumDeclaration,
    TSModuleDeclaration, TSModuleDeclarationName, TaggedTemplateExpression,
    VariableDeclarationKind, VariableDeclarator,
  },
  builder::{AstBuilder, GetAstBuilder, NONE},
};
use oxc_ast_visit::{Visit, VisitMut, walk_mut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_index::{IndexBox, IndexSlice, IndexVec};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::{AstNodes, Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType, Span};
use oxc_str::Ident;
use oxc_syntax::{
  node::NodeId,
  operator::{BinaryOperator, UnaryOperator},
  scope::{ScopeFlags, ScopeId},
  symbol::{SymbolFlags, SymbolId},
};
use oxc_transformer::{JsxOptions, TransformOptions, Transformer};
use std::path::Path;

use super::shared::{CssImportSymbols, stable_name_hash};

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
  ClassBinding,
  CatchBinding,
  Reassigned,
  LoopBinding,
  NoInitializer,
  EnumDeclaration,
  NamespaceDeclaration,
  UnknownLocalBindingKind,
  NotValueBinding,
}

impl PredicateCode {
  fn as_code(self) -> &'static str {
    match self {
      Self::RuntimeParameter => "runtime-parameter",
      Self::ClassBinding => "class-binding",
      Self::CatchBinding => "catch-binding",
      Self::Reassigned => "reassigned",
      Self::LoopBinding => "loop-binding",
      Self::NoInitializer => "no-initializer",
      Self::EnumDeclaration => "enum-declaration",
      Self::NamespaceDeclaration => "namespace-declaration",
      Self::UnknownLocalBindingKind => "unknown-local-binding-kind",
      Self::NotValueBinding => "not-value-binding",
    }
  }
}

#[derive(Clone, Copy)]
enum ExpressionCode {
  DeleteExpression,
  CallExpression,
  InvalidComptimeCall,
  PrivateField,
  ArrayExpression,
  BindingMutationOutsideClosure,
  CapturedBindingMutation,
  PropertyMutation,
  AwaitExpression,
  ClassExpression,
  ImportExpression,
  NewExpression,
  ObjectExpression,
  SequenceExpression,
  TaggedTemplate,
  YieldExpression,
  PrivateInExpression,
  Jsx,
  SuperExpression,
  UnsupportedExpression,
}

impl ExpressionCode {
  fn as_code(self) -> &'static str {
    match self {
      Self::DeleteExpression => "delete-expression",
      Self::CallExpression => "call-expression",
      Self::InvalidComptimeCall => "invalid-comptime-call",
      Self::PrivateField => "private-field",
      Self::ArrayExpression => "array-expression",
      Self::BindingMutationOutsideClosure => "binding-mutation-outside-closure",
      Self::CapturedBindingMutation => "captured-binding-mutation",
      Self::PropertyMutation => "property-mutation",
      Self::AwaitExpression => "await-expression",
      Self::ClassExpression => "class-expression",
      Self::ImportExpression => "import-expression",
      Self::NewExpression => "new-expression",
      Self::ObjectExpression => "object-expression",
      Self::SequenceExpression => "sequence-expression",
      Self::TaggedTemplate => "tagged-template",
      Self::YieldExpression => "yield-expression",
      Self::PrivateInExpression => "private-in-expression",
      Self::Jsx => "jsx",
      Self::SuperExpression => "super-expression",
      Self::UnsupportedExpression => "unsupported-expression",
    }
  }

  fn dependency(expression: &Expression) -> Self {
    match expression {
      Expression::ArrayExpression(_) => Self::ArrayExpression,
      Expression::AwaitExpression(_) => Self::AwaitExpression,
      Expression::CallExpression(_) => Self::CallExpression,
      Expression::ClassExpression(_) => Self::ClassExpression,
      Expression::ImportExpression(_) => Self::ImportExpression,
      Expression::NewExpression(_) => Self::NewExpression,
      Expression::ObjectExpression(_) => Self::ObjectExpression,
      Expression::PrivateFieldExpression(_) => Self::PrivateField,
      Expression::SequenceExpression(_) => Self::SequenceExpression,
      Expression::TaggedTemplateExpression(_) => Self::TaggedTemplate,
      Expression::YieldExpression(_) => Self::YieldExpression,
      Expression::PrivateInExpression(_) => Self::PrivateInExpression,
      Expression::JSXElement(_) | Expression::JSXFragment(_) => Self::Jsx,
      // The remaining kinds have dedicated analyzer arms or cannot be parsed,
      // so they never reach the fallback diagnostic. They are still listed so
      // that expression kinds added by oxc upgrades fail to compile here
      // instead of silently reporting the library-gap diagnostic.
      Expression::BooleanLiteral(_)
      | Expression::NullLiteral(_)
      | Expression::NumericLiteral(_)
      | Expression::BigIntLiteral(_)
      | Expression::RegExpLiteral(_)
      | Expression::StringLiteral(_)
      | Expression::TemplateLiteral(_)
      | Expression::Identifier(_)
      | Expression::MetaProperty(_)
      | Expression::Super(_)
      | Expression::ArrowFunctionExpression(_)
      | Expression::AssignmentExpression(_)
      | Expression::BinaryExpression(_)
      | Expression::ChainExpression(_)
      | Expression::ConditionalExpression(_)
      | Expression::FunctionExpression(_)
      | Expression::LogicalExpression(_)
      | Expression::ParenthesizedExpression(_)
      | Expression::ThisExpression(_)
      | Expression::UnaryExpression(_)
      | Expression::UpdateExpression(_)
      | Expression::TSAsExpression(_)
      | Expression::TSSatisfiesExpression(_)
      | Expression::TSTypeAssertion(_)
      | Expression::TSNonNullExpression(_)
      | Expression::TSInstantiationExpression(_)
      | Expression::V8IntrinsicExpression(_)
      | Expression::ComputedMemberExpression(_)
      | Expression::StaticMemberExpression(_) => Self::UnsupportedExpression,
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
  BindingMutation {
    code: ExpressionCode,
    binding: &'alloc str,
    declaration: Option<Span>,
    closure: Option<Span>,
    span: Span,
  },
}

impl Issue<'_> {
  fn span(self) -> Span {
    match self {
      Self::Variable { span, .. }
      | Self::Expression { span, .. }
      | Self::BindingMutation { span, .. } => span,
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

  fn runtime_location_expression(
    &self,
    ast: &impl GetAstBuilder<'alloc>,
    span: Span,
  ) -> Expression<'alloc> {
    let resolved = self.resolve(span);
    let line = resolved.line;
    let column = resolved.column;
    let end_line = resolved.end_line;
    let end_column = resolved.end_column;

    quote_expr!(ast, span, @"{line}:{column}:{end_line}:{end_column}")
  }
}

enum SymbolState<'alloc> {
  Unseen,
  Import,
  AllowedDirect,
  AllowedThunk,
  AllowedCallMemo { decl_span: Span },
  RejectedThunk(Box<'alloc, RejectedInfo<'alloc>>),
  RejectedCallMemo(Box<'alloc, RejectedInfo<'alloc>>),
}

impl SymbolState<'_> {
  fn is_extracted(&self) -> bool {
    !matches!(self, Self::Unseen)
  }

  fn is_owned_declaration(&self) -> bool {
    matches!(
      self,
      Self::AllowedDirect | Self::AllowedThunk | Self::AllowedCallMemo { .. }
    )
  }

  fn needs_cell(&self) -> bool {
    matches!(self, Self::AllowedThunk | Self::AllowedCallMemo { .. })
  }

  fn is_call_memo(&self) -> bool {
    matches!(
      self,
      Self::AllowedCallMemo { .. } | Self::RejectedCallMemo(_)
    )
  }
}

struct RejectedInfo<'alloc> {
  decl_span: Option<Span>,
  issue: Issue<'alloc>,
}

#[derive(Clone, Copy)]
struct ClosureScopes {
  local: ScopeId,
  writable: ScopeId,
  writable_start: Span,
}

#[derive(Clone, Copy)]
enum ExpressionAnalysisMode {
  Binding,
  Interpolation(Option<ClosureScopes>),
}

impl ExpressionAnalysisMode {
  fn in_closure(self, scope_id: ScopeId, start: Span) -> Self {
    match self {
      Self::Binding | Self::Interpolation(None) => Self::Interpolation(Some(ClosureScopes {
        local: scope_id,
        writable: scope_id,
        writable_start: start,
      })),
      Self::Interpolation(Some(scopes)) => Self::Interpolation(Some(ClosureScopes {
        local: scopes.local,
        writable: scope_id,
        writable_start: start,
      })),
    }
  }

  fn is_local(self, ident: &IdentifierReference, scoping: &Scoping) -> bool {
    let Self::Interpolation(Some(scopes)) = self else {
      return false;
    };
    symbol_is_declared_in_scope(ident, scopes.local, scoping)
  }

  fn is_writable(self, ident: &IdentifierReference, scoping: &Scoping) -> bool {
    let Self::Interpolation(Some(scopes)) = self else {
      return false;
    };
    symbol_is_declared_in_scope(ident, scopes.writable, scoping)
  }

  fn binding_mutation_code(self) -> ExpressionCode {
    if matches!(self, Self::Interpolation(Some(_))) {
      ExpressionCode::CapturedBindingMutation
    } else {
      ExpressionCode::BindingMutationOutsideClosure
    }
  }

  fn capturing_closure(self) -> Option<Span> {
    let Self::Interpolation(Some(scopes)) = self else {
      return None;
    };
    Some(scopes.writable_start)
  }
}

fn arrow_closure_start_span(arrow: &ArrowFunctionExpression) -> Span {
  Span::new(arrow.span.start, arrow.span.start + 1)
}

fn function_header_span(function: &Function) -> Span {
  Span::new(function.span.start, function.params.span.start)
}

fn symbol_is_declared_in_scope(
  ident: &IdentifierReference,
  scope_id: ScopeId,
  scoping: &Scoping,
) -> bool {
  referenced_symbol_id(scoping, ident).is_some_and(|symbol_id| {
    scoping
      .scope_ancestors(scoping.symbol_scope_id(symbol_id))
      .any(|ancestor| ancestor == scope_id)
  })
}

struct SymbolAnalyzer<'ast, 'alloc> {
  allocator: &'alloc Allocator,
  css_import_symbols: &'ast CssImportSymbols<'alloc>,
  nodes: &'ast AstNodes<'ast>,
  scoping: &'ast Scoping,
  resolving_symbols: BitSet<'alloc>,
  symbol_states: &'ast mut IndexSlice<SymbolId, [SymbolState<'alloc>]>,
}

impl<'ast, 'alloc> SymbolAnalyzer<'ast, 'alloc> {
  fn mark_symbol_live(&mut self, symbol_id: SymbolId) {
    let symbol_index = symbol_id.index();
    if !matches!(self.symbol_states[symbol_id], SymbolState::Unseen)
      || self.resolving_symbols.get(symbol_index)
    {
      return;
    }

    let flags = self.scoping.symbol_flags(symbol_id);
    if flags.is_import() {
      self.symbol_states[symbol_id] = SymbolState::Import;
      return;
    }
    if flags.is_function() && self.find_function_declaration(symbol_id).is_none() {
      return;
    }

    self.resolving_symbols.set(symbol_index, true);
    let state = self.build_symbol_state(symbol_id);
    self.resolving_symbols.set(symbol_index, false);
    self.symbol_states[symbol_id] = state;
  }

  fn build_symbol_state(&mut self, symbol_id: SymbolId) -> SymbolState<'alloc> {
    let allocator = self.allocator;
    let scoping = self.scoping;
    let flags = scoping.symbol_flags(symbol_id);

    if flags.is_function() {
      let function = self.find_function_declaration(symbol_id).unwrap();
      if let Some(rejected_span) = self.symbol_reassignment_span(symbol_id) {
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
      return match self.analyze_function_declaration(function) {
        Ok(()) => SymbolState::AllowedDirect,
        Err(issue) => make_rejected_state(allocator, false, None, issue),
      };
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
          self.non_declarator_binding_span(symbol_id, flags),
        ),
      );
    }

    if flags.is_catch_variable() {
      let span = self.symbol_span(symbol_id);
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

    let variable_declarator = self.find_variable_declarator(symbol_id);

    if let Some(rejected_span) = self.symbol_reassignment_span(symbol_id) {
      let is_var = variable_declarator.is_some_and(|declarator| declarator.kind.is_var());
      let decl_span = variable_declarator.map(|declarator| declarator.span);
      return make_rejected_state(
        allocator,
        is_var,
        decl_span,
        symbol_issue(
          allocator,
          scoping,
          symbol_id,
          PredicateCode::Reassigned,
          rejected_span,
        ),
      );
    }

    let Some(variable_declarator) = variable_declarator else {
      let predicate = if flags.is_function_scoped_declaration() {
        PredicateCode::RuntimeParameter
      } else {
        Self::non_declarator_binding_predicate(flags)
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
          self.non_declarator_binding_span(symbol_id, flags),
        ),
      );
    };

    let declarator_span = variable_declarator.span;
    let is_var = variable_declarator.kind.is_var();

    if self.is_loop_declarator(variable_declarator) {
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

    let analysis = if variable_declarator.id.is_destructuring_pattern() {
      DestructuringAnalyzer {
        symbols: self,
        target: symbol_id,
      }
      .analyze(&variable_declarator.id, init)
      .map(|()| false)
    } else {
      self.analyze_binding_expression(init)
    };

    let is_plain = match analysis {
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

  fn find_variable_declarator(
    &self,
    symbol_id: SymbolId,
  ) -> Option<&'ast VariableDeclarator<'ast>> {
    let declaration_node_id = self.scoping.symbol_declaration(symbol_id);

    if let AstKind::VariableDeclarator(declarator) = self.nodes.get_node(declaration_node_id).kind()
    {
      return Some(declarator);
    }

    for ancestor_id in self.nodes.ancestor_ids(declaration_node_id) {
      if let AstKind::VariableDeclarator(declarator) = self.nodes.get_node(ancestor_id).kind() {
        return Some(declarator);
      }
    }

    None
  }

  fn find_function_declaration(&self, symbol_id: SymbolId) -> Option<&'ast Function<'ast>> {
    self
      .scoping
      .symbol_declarations(symbol_id)
      .find_map(|declaration_node_id| {
        let AstKind::Function(function) = self.nodes.get_node(declaration_node_id).kind() else {
          return None;
        };
        (matches!(function.r#type, FunctionType::FunctionDeclaration) && function.body.is_some())
          .then_some(function)
      })
  }

  fn is_loop_declarator(&self, declarator: &VariableDeclarator) -> bool {
    let parent_id = self.nodes.parent_id(declarator.node_id.get());
    let grandparent_id = self.nodes.parent_id(parent_id);

    matches!(
      self.nodes.get_node(grandparent_id).kind(),
      AstKind::ForStatement(_) | AstKind::ForInStatement(_) | AstKind::ForOfStatement(_)
    )
  }

  fn symbol_span(&self, symbol_id: SymbolId) -> Span {
    self
      .nodes
      .get_node(self.scoping.symbol_declaration(symbol_id))
      .kind()
      .span()
  }

  fn symbol_reassignment_span(&self, symbol_id: SymbolId) -> Option<Span> {
    let write_span = self
      .scoping
      .get_resolved_references(symbol_id)
      .find(|reference| reference.is_write())
      .map(|reference| self.nodes.get_node(reference.node_id()).kind().span());
    let redeclaration_span = if self
      .scoping
      .symbol_flags(symbol_id)
      .is_function_scoped_declaration()
    {
      self
        .scoping
        .symbol_redeclarations(symbol_id)
        .get(1)
        .map(|redeclaration| redeclaration.span)
    } else {
      None
    };

    write_span
      .into_iter()
      .chain(redeclaration_span)
      .min_by_key(|span| span.start)
  }

  fn non_declarator_binding_span(&self, symbol_id: SymbolId, flags: SymbolFlags) -> Span {
    let declaration_node = self
      .nodes
      .get_node(self.scoping.symbol_declaration(symbol_id));

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

  fn non_declarator_binding_predicate(flags: SymbolFlags) -> PredicateCode {
    if flags.is_enum() {
      return PredicateCode::EnumDeclaration;
    }

    if flags.is_value_module() {
      return PredicateCode::NamespaceDeclaration;
    }

    PredicateCode::UnknownLocalBindingKind
  }
}

#[derive(Clone, Copy)]
struct BindingSymbol {
  symbol_id: SymbolId,
  span: Span,
}

fn collect_binding_symbols(pattern: &BindingPattern, symbols: &mut std::vec::Vec<BindingSymbol>) {
  match pattern {
    BindingPattern::BindingIdentifier(identifier) => symbols.push(BindingSymbol {
      symbol_id: identifier.symbol_id(),
      span: identifier.span,
    }),
    BindingPattern::ObjectPattern(pattern) => {
      for property in &pattern.properties {
        collect_binding_symbols(&property.value, symbols);
      }
      if let Some(rest) = &pattern.rest {
        collect_binding_symbols(&rest.argument, symbols);
      }
    }
    BindingPattern::ArrayPattern(pattern) => {
      for element in pattern.elements.iter().flatten() {
        collect_binding_symbols(element, symbols);
      }
      if let Some(rest) = &pattern.rest {
        collect_binding_symbols(&rest.argument, symbols);
      }
    }
    BindingPattern::AssignmentPattern(pattern) => {
      collect_binding_symbols(&pattern.left, symbols);
    }
  }
}

struct DestructuringTargetBuilder<'ctx, 'alloc> {
  ast: AstBuilder<'alloc>,
  scoping: &'ctx Scoping,
  symbol_states: &'ctx IndexSlice<SymbolId, [SymbolState<'alloc>]>,
  declaration_node_id: NodeId,
}

impl<'alloc> GetAstBuilder<'alloc> for DestructuringTargetBuilder<'_, 'alloc> {
  type Builder = AstBuilder<'alloc>;

  fn builder(&self) -> &Self::Builder {
    &self.ast
  }
}

impl<'alloc> GetAllocator<'alloc> for DestructuringTargetBuilder<'_, 'alloc> {
  fn allocator(&self) -> &'alloc Allocator {
    self.ast.allocator()
  }
}

impl<'ctx, 'alloc> DestructuringTargetBuilder<'ctx, 'alloc> {
  fn build(&self, pattern: BindingPattern<'alloc>) -> Option<AssignmentTarget<'alloc>> {
    match pattern {
      BindingPattern::BindingIdentifier(identifier) => {
        let identifier = identifier.unbox();
        if !is_symbol_declaration(
          self.scoping,
          identifier.symbol_id(),
          identifier.span,
          self.declaration_node_id,
        ) || !self.symbol_states[identifier.symbol_id()].needs_cell()
        {
          return None;
        }

        Some(AssignmentTarget::StaticMemberExpression(
          StaticMemberExpression::boxed(
            identifier.span,
            Expression::new_identifier(identifier.span, identifier.name, self),
            IdentifierName::new(identifier.span, "value", self),
            false,
            self,
          ),
        ))
      }
      BindingPattern::ObjectPattern(pattern) => {
        let pattern = pattern.unbox();
        let rest = pattern.rest.and_then(|rest| {
          let rest = rest.unbox();
          self
            .build(rest.argument)
            .map(|target| AssignmentTargetRest::boxed(rest.span, target, self))
        });
        let preserve_exclusions = rest.is_some();
        let properties = Vec::from_iter_in(
          pattern.properties.into_iter().filter_map(|property| {
            let binding = self.build_maybe_default(property.value).or_else(|| {
              preserve_exclusions.then(|| Self::maybe_default(self.discard(property.span)))
            })?;

            Some(
              AssignmentTargetProperty::new_assignment_target_property_property(
                property.span,
                property.key,
                binding,
                property.computed,
                self,
              ),
            )
          }),
          self,
        );
        if properties.is_empty() && rest.is_none() {
          return None;
        }

        Some(AssignmentTarget::ObjectAssignmentTarget(
          ObjectAssignmentTarget::boxed(pattern.span, properties, rest, self),
        ))
      }
      BindingPattern::ArrayPattern(pattern) => {
        let pattern = pattern.unbox();
        let rest = pattern.rest.and_then(|rest| {
          let rest = rest.unbox();
          self
            .build(rest.argument)
            .map(|target| AssignmentTargetRest::boxed(rest.span, target, self))
        });
        let mut elements = Vec::from_iter_in(
          pattern
            .elements
            .into_iter()
            .map(|element| element.and_then(|element| self.build_maybe_default(element))),
          self,
        );
        if rest.is_none() {
          while elements.last().is_some_and(Option::is_none) {
            elements.pop();
          }
        }
        if elements.is_empty() && rest.is_none() {
          return None;
        }

        Some(AssignmentTarget::ArrayAssignmentTarget(
          ArrayAssignmentTarget::boxed(pattern.span, elements, rest, self),
        ))
      }
      BindingPattern::AssignmentPattern(_) => unreachable!(),
    }
  }

  fn build_maybe_default(
    &self,
    pattern: BindingPattern<'alloc>,
  ) -> Option<AssignmentTargetMaybeDefault<'alloc>> {
    if let BindingPattern::AssignmentPattern(pattern) = pattern {
      let pattern = pattern.unbox();
      let binding = self.build(pattern.left)?;
      return Some(
        AssignmentTargetMaybeDefault::new_assignment_target_with_default(
          pattern.span,
          binding,
          pattern.right,
          self,
        ),
      );
    }

    self.build(pattern).map(Self::maybe_default)
  }

  fn maybe_default(target: AssignmentTarget<'alloc>) -> AssignmentTargetMaybeDefault<'alloc> {
    match target {
      AssignmentTarget::StaticMemberExpression(expression) => {
        AssignmentTargetMaybeDefault::StaticMemberExpression(expression)
      }
      AssignmentTarget::ObjectAssignmentTarget(pattern) => {
        AssignmentTargetMaybeDefault::ObjectAssignmentTarget(pattern)
      }
      AssignmentTarget::ArrayAssignmentTarget(pattern) => {
        AssignmentTargetMaybeDefault::ArrayAssignmentTarget(pattern)
      }
      _ => unreachable!(),
    }
  }

  fn discard(&self, span: Span) -> AssignmentTarget<'alloc> {
    AssignmentTarget::StaticMemberExpression(StaticMemberExpression::boxed(
      span,
      Expression::new_identifier(span, CSSLIT_STATE_NAME, self),
      IdentifierName::new(span, "discard", self),
      false,
      self,
    ))
  }
}

struct DestructuringAnalyzer<'ctx, 'ast, 'alloc> {
  symbols: &'ctx mut SymbolAnalyzer<'ast, 'alloc>,
  target: SymbolId,
}

impl<'alloc> DestructuringAnalyzer<'_, '_, 'alloc> {
  fn analyze(&mut self, pattern: &BindingPattern, init: &Expression) -> Result<(), Issue<'alloc>> {
    self.symbols.analyze_binding_expression(init)?;
    let found = self.analyze_pattern(pattern)?;
    debug_assert!(found);
    Ok(())
  }

  fn analyze_pattern(&mut self, pattern: &BindingPattern) -> Result<bool, Issue<'alloc>> {
    match pattern {
      BindingPattern::BindingIdentifier(identifier) => Ok(identifier.symbol_id() == self.target),
      BindingPattern::ObjectPattern(pattern) => {
        if let Some(rest) = &pattern.rest
          && self.analyze_pattern(&rest.argument)?
        {
          for property in &pattern.properties {
            if property.computed
              && let Some(expression) = property.key.as_expression()
            {
              self.symbols.analyze_binding_expression(expression)?;
            }
          }
          return Ok(true);
        }

        for property in &pattern.properties {
          if self.analyze_pattern(&property.value)? {
            if property.computed
              && let Some(expression) = property.key.as_expression()
            {
              self.symbols.analyze_binding_expression(expression)?;
            }
            return Ok(true);
          }
        }
        Ok(false)
      }
      BindingPattern::ArrayPattern(pattern) => {
        for element in pattern.elements.iter().flatten() {
          if self.analyze_pattern(element)? {
            return Ok(true);
          }
        }
        if let Some(rest) = &pattern.rest {
          return self.analyze_pattern(&rest.argument);
        }
        Ok(false)
      }
      BindingPattern::AssignmentPattern(pattern) => {
        if !self.analyze_pattern(&pattern.left)? {
          return Ok(false);
        }
        self.symbols.analyze_binding_expression(&pattern.right)?;
        Ok(true)
      }
    }
  }
}

impl<'ast, 'alloc> SymbolAnalyzer<'ast, 'alloc> {
  fn analyze_binding_expression(&mut self, expr: &Expression) -> Result<bool, Issue<'alloc>> {
    self.analyze_expression(expr, ExpressionAnalysisMode::Binding)
  }

  fn analyze_interpolation_expression(&mut self, expr: &Expression) -> Result<bool, Issue<'alloc>> {
    self.analyze_expression(expr, ExpressionAnalysisMode::Interpolation(None))
  }

  fn analyze_expression(
    &mut self,
    expr: &Expression,
    mode: ExpressionAnalysisMode,
  ) -> Result<bool, Issue<'alloc>> {
    let allocator = self.allocator;
    let css_import_symbols = self.css_import_symbols;
    let scoping = self.scoping;

    ExpressionAnalyzer {
      allocator,
      mode,
      css_import_symbols,
      on_identifier: &mut |ident: &IdentifierReference| -> Result<bool, Issue<'alloc>> {
        let Some((symbol_id, _)) = referenced_value_symbol_id(allocator, scoping, ident)? else {
          return Ok(false);
        };

        self.mark_symbol_live(symbol_id);
        Ok(matches!(
          self.symbol_states[symbol_id],
          SymbolState::AllowedDirect
        ))
      },
      scoping,
    }
    .analyze(expr)
  }

  fn analyze_function_declaration(&mut self, function: &Function) -> Result<(), Issue<'alloc>> {
    let allocator = self.allocator;
    let css_import_symbols = self.css_import_symbols;
    let scoping = self.scoping;
    let mut on_identifier = |ident: &IdentifierReference| {
      let Some((symbol_id, _)) = referenced_value_symbol_id(allocator, scoping, ident)? else {
        return Ok(false);
      };

      self.mark_symbol_live(symbol_id);
      Ok(matches!(
        self.symbol_states[symbol_id],
        SymbolState::AllowedDirect
      ))
    };
    let mut expressions = ExpressionAnalyzer {
      allocator,
      css_import_symbols,
      mode: ExpressionAnalysisMode::Binding
        .in_closure(function.scope_id(), function_header_span(function)),
      on_identifier: &mut on_identifier,
      scoping,
    };
    let mut body = ClosureBodyAnalyzer {
      expressions: &mut expressions,
      result: Ok(()),
    };
    oxc_ast_visit::walk::walk_function(&mut body, function, ScopeFlags::Function);
    body.result
  }
}

struct ExpressionAnalyzer<'ctx, 'alloc, F> {
  allocator: &'alloc Allocator,
  css_import_symbols: &'ctx CssImportSymbols<'alloc>,
  mode: ExpressionAnalysisMode,
  on_identifier: &'ctx mut F,
  scoping: &'ctx Scoping,
}

// Walks the statement structure inside a closure while delegating every
// expression back to the regular interpolation analyzer.
struct ClosureBodyAnalyzer<'analyzer, 'ctx, 'alloc, F> {
  expressions: &'analyzer mut ExpressionAnalyzer<'ctx, 'alloc, F>,
  result: Result<(), Issue<'alloc>>,
}

impl<'ast, 'alloc, F> ClosureBodyAnalyzer<'_, '_, 'alloc, F>
where
  F: FnMut(&IdentifierReference) -> Result<bool, Issue<'alloc>>,
{
  fn visit_wrapped_assignment_target(&mut self, expression: &Expression<'ast>, span: Span) {
    match expression {
      Expression::Identifier(identifier) => self.visit_identifier_reference(identifier),
      Expression::TSAsExpression(inner) => {
        self.visit_wrapped_assignment_target(&inner.expression, span);
      }
      Expression::TSSatisfiesExpression(inner) => {
        self.visit_wrapped_assignment_target(&inner.expression, span);
      }
      Expression::TSNonNullExpression(inner) => {
        self.visit_wrapped_assignment_target(&inner.expression, span);
      }
      Expression::TSTypeAssertion(inner) => {
        self.visit_wrapped_assignment_target(&inner.expression, span);
      }
      Expression::ParenthesizedExpression(inner) => {
        self.visit_wrapped_assignment_target(&inner.expression, span);
      }
      _ => {
        self.result = Err(Issue::Expression {
          code: ExpressionCode::PropertyMutation,
          span,
        });
      }
    }
  }
}

impl<'ast, 'alloc, F> Visit<'ast> for ClosureBodyAnalyzer<'_, '_, 'alloc, F>
where
  F: FnMut(&IdentifierReference) -> Result<bool, Issue<'alloc>>,
{
  fn visit_expression(&mut self, expression: &Expression<'ast>) {
    if self.result.is_err() {
      return;
    }

    if let Err(issue) = self.expressions.analyze(expression) {
      self.result = Err(issue);
    }
  }

  fn visit_assignment_target(&mut self, target: &AssignmentTarget<'ast>) {
    if self.result.is_err() {
      return;
    }

    match target {
      AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
        self.visit_identifier_reference(identifier);
      }
      AssignmentTarget::ArrayAssignmentTarget(_) | AssignmentTarget::ObjectAssignmentTarget(_) => {
        oxc_ast_visit::walk::walk_assignment_target(self, target);
      }
      // TypeScript wrappers around an identifier are still binding mutations.
      AssignmentTarget::TSAsExpression(expression) => {
        self.visit_wrapped_assignment_target(&expression.expression, target.span());
      }
      AssignmentTarget::TSSatisfiesExpression(expression) => {
        self.visit_wrapped_assignment_target(&expression.expression, target.span());
      }
      AssignmentTarget::TSNonNullExpression(expression) => {
        self.visit_wrapped_assignment_target(&expression.expression, target.span());
      }
      AssignmentTarget::TSTypeAssertion(expression) => {
        self.visit_wrapped_assignment_target(&expression.expression, target.span());
      }
      _ => {
        self.result = Err(Issue::Expression {
          code: ExpressionCode::PropertyMutation,
          span: target.span(),
        });
      }
    }
  }

  fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'ast>) {
    if self.result.is_ok()
      && !self
        .expressions
        .mode
        .is_writable(identifier, self.expressions.scoping)
    {
      self.result = Err(
        self
          .expressions
          .binding_mutation_issue(identifier, identifier.span),
      );
    }
  }

  fn visit_function(&mut self, function: &Function<'ast>, flags: ScopeFlags) {
    if self.result.is_err() {
      return;
    }

    let mode = self.expressions.mode;
    self.expressions.mode = mode.in_closure(function.scope_id(), function_header_span(function));
    oxc_ast_visit::walk::walk_function(self, function, flags);
    self.expressions.mode = mode;
  }

  fn visit_class(&mut self, class: &Class<'ast>) {
    if self.result.is_ok() {
      self.result = Err(Issue::Expression {
        code: ExpressionCode::ClassExpression,
        span: class_header_span(class),
      });
    }
  }
}

// Points at `class Name` rather than the whole class body.
fn class_header_span(class: &Class) -> Span {
  let end = class
    .id
    .as_ref()
    .map_or(class.span.start + 5, |id| id.span.end);
  Span::new(class.span.start, end)
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
  let info = Box::new_in(RejectedInfo { decl_span, issue }, &allocator);

  if is_call_memo {
    SymbolState::RejectedCallMemo(info)
  } else {
    SymbolState::RejectedThunk(info)
  }
}

fn is_symbol_declaration(
  scoping: &Scoping,
  symbol_id: SymbolId,
  binding_span: Span,
  declaration_node_id: NodeId,
) -> bool {
  scoping.symbol_declaration(symbol_id) == declaration_node_id
    && scoping.symbol_span(symbol_id) == binding_span
}

struct TemplateDiscoveryVisitor<'ast, 'alloc> {
  symbols: SymbolAnalyzer<'ast, 'alloc>,
}

impl<'ast, 'alloc> Visit<'ast> for TemplateDiscoveryVisitor<'ast, 'alloc> {
  fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'ast>) {
    if self
      .symbols
      .css_import_symbols
      .is_css_with_scoping(&it.tag, self.symbols.scoping)
      || self
        .symbols
        .css_import_symbols
        .is_global_css_with_scoping(&it.tag, self.symbols.scoping)
    {
      for expression in &it.quasi.expressions {
        if self
          .symbols
          .analyze_interpolation_expression(expression)
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

struct CompileTimeEmitter<'ast, 'alloc> {
  ast: AstBuilder<'alloc>,
  css_sourcemap: bool,
  css_import_symbols: &'ast CssImportSymbols<'alloc>,
  filename: &'ast str,
  frames: Vec<'ast, EmitFrame<'ast>>,
  location_context: &'ast SourceLocationContext<'ast>,
  // Nodes in the current subtree must remain in the generated evaluation program.
  preserve_source_ast: bool,
  root_body: Vec<'ast, Statement<'ast>>,
  scoping: &'ast Scoping,
  symbol_states: &'ast IndexSlice<SymbolId, [SymbolState<'alloc>]>,
}

impl<'alloc> GetAstBuilder<'alloc> for CompileTimeEmitter<'_, 'alloc> {
  type Builder = AstBuilder<'alloc>;

  fn builder(&self) -> &Self::Builder {
    &self.ast
  }
}

impl<'alloc> GetAllocator<'alloc> for CompileTimeEmitter<'_, 'alloc> {
  fn allocator(&self) -> &'alloc Allocator {
    self.ast.allocator()
  }
}

impl<'ast, 'alloc> CompileTimeEmitter<'ast, 'alloc> {
  fn with_preserved_ast<R>(&mut self, preserve: bool, visit: impl FnOnce(&mut Self) -> R) -> R {
    let previous = self.preserve_source_ast;
    self.preserve_source_ast = preserve;
    let result = visit(self);
    self.preserve_source_ast = previous;
    result
  }

  fn binding_mutation_issue_expression(
    &self,
    span: Span,
    code: ExpressionCode,
    binding: &'alloc str,
    declaration: Option<Span>,
    closure: Option<Span>,
  ) -> Expression<'ast> {
    let code = code.as_code();
    let declaration = declaration.map(|span| {
      self
        .location_context
        .runtime_location_expression(self, span)
    });
    let closure = closure.map(|span| {
      self
        .location_context
        .runtime_location_expression(self, span)
    });

    match (declaration, closure) {
      (Some(declaration), Some(closure)) => quote_expr!(
        self,
        span,
        ({
          code: @{code},
          binding: @{binding},
          declaration: @{declaration},
          closure: @{closure}
        })
      ),
      (Some(declaration), None) => quote_expr!(
        self,
        span,
        ({ code: @{code}, binding: @{binding}, declaration: @{declaration} })
      ),
      (None, Some(closure)) => quote_expr!(
        self,
        span,
        ({ code: @{code}, binding: @{binding}, closure: @{closure} })
      ),
      (None, None) => quote_expr!(self, span, ({ code: @{code}, binding: @{binding} })),
    }
  }

  fn visit_emitted_expression(&mut self, expression: &mut Expression<'ast>) {
    self.with_preserved_ast(true, |this| this.visit_expression(expression));
  }

  fn extract_initializer(
    &mut self,
    initializer: &mut Option<Expression<'ast>>,
  ) -> Expression<'ast> {
    if self.preserve_source_ast {
      let initializer = initializer
        .as_mut()
        .expect("live simple bindings must have an initializer");
      // Transform before cloning so nested CSS is emitted once and both copies contain its value.
      self.visit_expression(initializer);
      initializer.clone_in_with_semantic_ids(self.allocator())
    } else {
      let mut initializer = initializer
        .take()
        .expect("live simple bindings must have an initializer");
      self.visit_emitted_expression(&mut initializer);
      initializer
    }
  }

  fn extract_destructuring_parts(
    &mut self,
    declarator: &mut VariableDeclarator<'ast>,
  ) -> (BindingPattern<'ast>, Expression<'ast>) {
    if self.preserve_source_ast {
      self.visit_expression(
        declarator
          .init
          .as_mut()
          .expect("live destructuring bindings must have an initializer"),
      );
      walk_mut::walk_binding_pattern(self, &mut declarator.id);
      (
        declarator.id.clone_in_with_semantic_ids(self.allocator()),
        declarator
          .init
          .as_ref()
          .unwrap()
          .clone_in_with_semantic_ids(self.allocator()),
      )
    } else {
      let mut pattern = declarator.id.take_in(self);
      let mut initializer = declarator
        .init
        .take()
        .expect("live destructuring bindings must have an initializer");
      self.with_preserved_ast(true, |this| {
        this.visit_expression(&mut initializer);
        walk_mut::walk_binding_pattern(this, &mut pattern);
      });
      (pattern, initializer)
    }
  }

  fn is_declaration_binding(&self, binding: BindingSymbol, declaration_node_id: NodeId) -> bool {
    is_symbol_declaration(
      self.scoping,
      binding.symbol_id,
      binding.span,
      declaration_node_id,
    )
  }

  fn analyze_expression_for_synthesis(
    &self,
    expression: &Expression,
  ) -> Result<bool, Issue<'alloc>> {
    ExpressionAnalyzer {
      allocator: self.allocator(),
      css_import_symbols: self.css_import_symbols,
      mode: ExpressionAnalysisMode::Interpolation(None),
      on_identifier: &mut |identifier: &IdentifierReference| -> Result<bool, Issue<'alloc>> {
        let Some((symbol_id, flags)) =
          referenced_value_symbol_id(self.allocator(), self.scoping, identifier)?
        else {
          return Ok(false);
        };

        if flags.is_import() || matches!(self.symbol_states[symbol_id], SymbolState::Unseen) {
          return Ok(false);
        }

        Ok(matches!(
          self.symbol_states[symbol_id],
          SymbolState::AllowedDirect
        ))
      },
      scoping: self.scoping,
    }
    .analyze(expression)
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

    self.push_binding_statement(Statement::ImportDeclaration(Box::new_in(import, self)));
  }

  fn emit_binding_pattern(&mut self, pattern: &BindingPattern<'ast>) {
    match pattern {
      BindingPattern::BindingIdentifier(identifier) => {
        let symbol_id = identifier.symbol_id();
        if !self.symbol_states[symbol_id].is_extracted() {
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
        ReferenceRewriter {
          ast: AstBuilder::new(self.allocator()),
          location_context: self.location_context,
          mode: ExpressionAnalysisMode::Interpolation(None),
          scoping: self.scoping,
          symbol_states: self.symbol_states,
        }
        .visit_expression(&mut init);
        quote_stmt!(self, const @{name} = @{init};)
      }
      state @ (SymbolState::AllowedThunk | SymbolState::AllowedCallMemo { .. }) => {
        let init_span = init.span();
        ReferenceRewriter {
          ast: AstBuilder::new(self.allocator()),
          location_context: self.location_context,
          mode: ExpressionAnalysisMode::Interpolation(None),
          scoping: self.scoping,
          symbol_states: self.symbol_states,
        }
        .visit_expression(&mut init);
        let arrow = quote_expr!(self, init_span, () => @{init});
        let location = self
          .location_context
          .runtime_location_expression(self, init_span);
        let expression =
          quote_expr!(self, init_span, __csslit.cell(@{name}, @{location}, @{arrow}));

        if state.is_call_memo() {
          quote_stmt!(self, var @{name} = @{expression};)
        } else {
          quote_stmt!(self, const @{name} = @{expression};)
        }
      }
      _ => unreachable!(),
    }
  }

  fn emit_destructuring_declarator(
    &mut self,
    mut pattern: BindingPattern<'ast>,
    mut init: Expression<'ast>,
    bound_symbols: std::vec::Vec<BindingSymbol>,
    kind: VariableDeclarationKind,
    span: Span,
    declaration_node_id: NodeId,
  ) {
    let pattern_span = pattern.span();
    let initializer_span = init.span();
    let mut rewriter = ReferenceRewriter {
      ast: AstBuilder::new(self.allocator()),
      location_context: self.location_context,
      mode: ExpressionAnalysisMode::Interpolation(None),
      scoping: self.scoping,
      symbol_states: self.symbol_states,
    };
    rewriter.visit_expression(&mut init);
    rewriter.visit_binding_pattern(&mut pattern);

    for binding in bound_symbols.iter().copied() {
      let symbol_id = binding.symbol_id;
      if !self.is_declaration_binding(binding, declaration_node_id) {
        continue;
      }

      match self.symbol_states[symbol_id] {
        SymbolState::RejectedThunk(_) | SymbolState::RejectedCallMemo(_) => {
          self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
        }
        SymbolState::AllowedThunk | SymbolState::AllowedCallMemo { .. } => {
          let name = self.scoping.symbol_name(symbol_id);
          let location = self
            .location_context
            .runtime_location_expression(self, pattern_span);
          let statement = if kind.is_var() {
            quote_stmt!(self, pattern_span, var @{name} = __csslit.cell(@{name}, @{location});)
          } else {
            quote_stmt!(self, pattern_span, const @{name} = __csslit.cell(@{name}, @{location});)
          };
          self.push_binding_statement(statement);
        }
        _ => {}
      }
    }

    let cells = bound_symbols
      .iter()
      .filter(|binding| {
        self.is_declaration_binding(**binding, declaration_node_id)
          && self.symbol_states[binding.symbol_id].needs_cell()
      })
      .map(|binding| {
        Expression::new_identifier(span, self.scoping.symbol_name(binding.symbol_id), self)
      });
    let target = DestructuringTargetBuilder {
      ast: AstBuilder::new(self.allocator()),
      scoping: self.scoping,
      symbol_states: self.symbol_states,
      declaration_node_id,
    }
    .build(pattern)
    .expect("live destructuring declarators must have a live assignment target");

    let mut value_name = format!("__csslit_destructure_value_{}", span.start);
    while self.scoping.symbol_names().any(|name| name == value_name)
      || self
        .scoping
        .root_unresolved_references()
        .contains_key(value_name.as_str())
    {
      value_name.push('_');
    }
    let value_name = Ident::from_str_in(&value_name, self);
    let value = Expression::new_identifier(pattern_span, value_name, self);
    let assignment = quote_expr!(self, pattern_span, @{target} = @{value});
    let initialize = quote_expr!(self, initializer_span, () => @{init});
    let apply_pattern = quote_expr!(self, pattern_span, @{value_name} => @{assignment});
    let initializer_location = self
      .location_context
      .runtime_location_expression(self, initializer_span);

    self.push_binding_statement(quote_stmt!(
      self,
      span,
      __csslit.destructure(
        [@{..cells}],
        @{initializer_location},
        @{initialize},
        @{apply_pattern}
      );
    ));
  }

  fn build_non_owned_symbol_statement(&self, symbol_id: SymbolId) -> Statement<'ast> {
    let name = self.scoping.symbol_name(symbol_id);

    match &self.symbol_states[symbol_id] {
      state @ (SymbolState::RejectedThunk(info) | SymbolState::RejectedCallMemo(info)) => {
        let span = info.issue.span();
        let location_expr = self
          .location_context
          .runtime_location_expression(self, span);
        let expression = match info.issue {
          Issue::Variable { predicate, .. } => {
            let predicate_text = predicate.as_code();
            quote_expr!(
              self,
              span,
              __csslit.cellVarErr(@{name}, @{predicate_text}, @{location_expr})
            )
          }
          Issue::Expression { code, .. } => {
            let code = code.as_code();
            quote_expr!(
              self,
              span,
              __csslit.cellExprErr(@{name}, @{location_expr}, { code: @{code} })
            )
          }
          Issue::BindingMutation {
            code,
            binding,
            declaration,
            closure,
            ..
          } => {
            let issue =
              self.binding_mutation_issue_expression(span, code, binding, declaration, closure);
            quote_expr!(
              self,
              span,
              __csslit.cellExprErr(@{name}, @{location_expr}, @{issue})
            )
          }
        };

        if state.is_call_memo() {
          quote_stmt!(self, var @{name} = @{expression};)
        } else {
          quote_stmt!(self, const @{name} = @{expression};)
        }
      }
      SymbolState::AllowedDirect
      | SymbolState::AllowedThunk
      | SymbolState::AllowedCallMemo { .. }
      | SymbolState::Import
      | SymbolState::Unseen => unreachable!(),
    }
  }

  fn build_function_placeholder_statement(&self, mut function: Function<'ast>) -> Statement<'ast> {
    let identifier = function.id.as_ref().unwrap();
    let span = identifier.span;
    let use_location_expr = quote_expr!(self, span, arguments[0]);
    let SymbolState::RejectedThunk(info) = &self.symbol_states[identifier.symbol_id()] else {
      unreachable!();
    };
    let issue_location = self
      .location_context
      .runtime_location_expression(self, info.issue.span());
    let err_expr = match info.issue {
      Issue::Variable {
        name, predicate, ..
      } => {
        let predicate_text = predicate.as_code();
        quote_expr!(
          self,
          span,
          __csslit.varErr(@{name}, @{predicate_text}, @{use_location_expr}, @{issue_location})
        )
      }
      Issue::Expression { code, .. } => {
        let code = code.as_code();
        quote_expr!(self, span, __csslit.exprErr(@{issue_location}, { code: @{code} }))
      }
      Issue::BindingMutation {
        code,
        binding,
        declaration,
        closure,
        ..
      } => {
        let issue =
          self.binding_mutation_issue_expression(span, code, binding, declaration, closure);
        quote_expr!(self, span, __csslit.exprErr(@{issue_location}, @{issue}))
      }
    };
    let return_statement = quote_stmt!(self, span, return @{err_expr};);

    if let Some(body) = function.body.as_mut() {
      body.directives.clear();
      body.statements.clear();
      body.statements.push(return_statement);
    }

    Statement::FunctionDeclaration(Box::new_in(function, self))
  }
}

impl<'ast, 'alloc> VisitMut<'ast> for CompileTimeEmitter<'ast, 'alloc> {
  fn enter_scope(&mut self, flags: ScopeFlags, _scope_id: &std::cell::Cell<Option<ScopeId>>) {
    let mut body = Vec::new_in(self);
    if self.frames.is_empty() {
      body.push(quote_stmt!(
        self,
        import * as @{CSSLIT_RUNTIME_NAME} from @"virtual:csslit-eval-runtime";
      ));
      let state_init = quote_expr!(self, __csslit_eval_runtime.init());
      body.push(quote_stmt!(self, const @{CSSLIT_STATE_NAME} = @{state_init};));
    }

    self.frames.push(EmitFrame {
      body,
      has_live_bindings: false,
      flags,
    });
  }

  fn leave_scope(&mut self) {
    let frame = self.frames.pop().unwrap();

    if self.frames.is_empty() {
      self.root_body = frame.body;
      return;
    }

    if frame.body.is_empty() {
      return;
    }

    if frame.flags.is_function() || frame.flags.is_arrow() || frame.flags.is_class_static_block() {
      let body = frame.body;
      let task = quote_expr!(self, () => { @{..body} });
      let statement = quote_stmt!(self, __csslit.defer(@{task}););
      self.frames.last_mut().unwrap().body.push(statement);
      return;
    }

    if frame.has_live_bindings {
      let body = frame.body;
      let statement = quote_stmt!(self, { @{..body} });
      self.frames.last_mut().unwrap().body.push(statement);
      return;
    }

    self.frames.last_mut().unwrap().body.extend(frame.body);
  }

  fn visit_import_declaration(&mut self, import: &mut ImportDeclaration<'ast>) {
    self.emit_import_declaration(import.take_in(self));
  }

  fn visit_expression(&mut self, expr: &mut Expression<'ast>) {
    let Expression::TaggedTemplateExpression(tagged) = expr else {
      walk_mut::walk_expression(self, expr);
      return;
    };

    let is_css = self
      .css_import_symbols
      .is_css_with_scoping(&tagged.tag, self.scoping);

    let is_global_css = self
      .css_import_symbols
      .is_global_css_with_scoping(&tagged.tag, self.scoping);

    if !is_css && !is_global_css {
      walk_mut::walk_expression(self, expr);
      return;
    }

    let span = tagged.span;
    let template_location = self.location_context.resolve(span);
    let line = template_location.line;
    let column = template_location.column;
    let local_line = line + 1;
    let local_column = column + 1;
    let hash = stable_name_hash(self.filename, line, column);
    let mut template = tagged.quasi.take_in(self);
    for expression in &mut template.expressions {
      let span = expression.span();
      let mut rewritten_expression = expression.take_in(self);
      self.visit_emitted_expression(&mut rewritten_expression);
      let should_capture = match self.analyze_expression_for_synthesis(&rewritten_expression) {
        Ok(is_plain) => {
          ReferenceRewriter {
            ast: AstBuilder::new(self.allocator()),
            location_context: self.location_context,
            mode: ExpressionAnalysisMode::Interpolation(None),
            scoping: self.scoping,
            symbol_states: self.symbol_states,
          }
          .visit_expression(&mut rewritten_expression);
          !is_plain
        }
        Err(issue) => {
          let span = issue.span();
          let location_expr = self
            .location_context
            .runtime_location_expression(self, span);
          let expression = match issue {
            Issue::Variable {
              name, predicate, ..
            } => {
              let predicate_text = predicate.as_code();
              quote_expr!(
                self,
                span,
                __csslit.varErr(@{name}, @{predicate_text}, @{location_expr})
              )
            }
            Issue::Expression { code, .. } => {
              let code = code.as_code();
              quote_expr!(self, span, __csslit.exprErr(@{location_expr}, { code: @{code} }))
            }
            Issue::BindingMutation {
              code,
              binding,
              declaration,
              closure,
              ..
            } => {
              let issue =
                self.binding_mutation_issue_expression(span, code, binding, declaration, closure);
              quote_expr!(self, span, __csslit.exprErr(@{location_expr}, @{issue}))
            }
          };

          rewritten_expression = expression;
          true
        }
      };

      *expression = if should_capture {
        let arrow = quote_expr!(self, span, () => @{rewritten_expression});
        let location = self
          .location_context
          .runtime_location_expression(self, span);
        quote_expr!(self, span, __csslit.capture(@{location}, @{arrow}))
      } else {
        rewritten_expression
      };
    }

    let span = template.span;
    let callee = if self.css_sourcemap {
      let quasi_locations = template.quasis.iter().flat_map(|quasi| {
        // OXC TemplateElement spans begin at the first byte of the raw quasi contents.
        let raw_start = quasi.span.start;
        let location = self
          .location_context
          .resolve(Span::new(raw_start, raw_start));
        [location.line, location.column]
      });

      if is_global_css {
        quote_expr!(self, span, __csslit.globalCss([@{..quasi_locations}]))
      } else {
        quote_expr!(
          self,
          span,
          __csslit.css(@"{hash}_{local_line}_{local_column}", [@{..quasi_locations}])
        )
      }
    } else if is_global_css {
      quote_expr!(self, span, __csslit.globalCss())
    } else {
      quote_expr!(self, span, __csslit.css(@"{hash}_{local_line}_{local_column}"))
    };
    let css_eval = Expression::new_tagged_template_expression(span, callee, NONE, template, self);
    let statement = quote_stmt!(self, (@{css_eval}););
    self.frames.last_mut().unwrap().body.push(statement);
    *expr = if is_global_css {
      quote_expr!(self, span, undefined)
    } else {
      quote_expr!(self, span, @"__csslit_class_{hash}_{local_line}_{local_column}")
    };
  }

  fn visit_variable_declarator(&mut self, declarator: &mut VariableDeclarator<'ast>) {
    let declaration_node_id = declarator.node_id.get();

    if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
      let symbol_id = identifier.symbol_id();
      if is_symbol_declaration(
        self.scoping,
        symbol_id,
        identifier.span,
        declaration_node_id,
      ) && self.symbol_states[symbol_id].is_owned_declaration()
      {
        let init = self.extract_initializer(&mut declarator.init);
        self.push_binding_statement(self.build_owned_symbol_statement(symbol_id, init));
        return;
      }
    }

    let mut bound_symbols = std::vec::Vec::new();
    collect_binding_symbols(&declarator.id, &mut bound_symbols);

    if declarator.id.is_destructuring_pattern() {
      if bound_symbols.iter().any(|binding| {
        self.is_declaration_binding(*binding, declaration_node_id)
          && self.symbol_states[binding.symbol_id].needs_cell()
      }) {
        let (pattern, init) = self.extract_destructuring_parts(declarator);
        self.emit_destructuring_declarator(
          pattern,
          init,
          bound_symbols,
          declarator.kind,
          declarator.span,
          declaration_node_id,
        );
        return;
      }
    }

    for binding in bound_symbols {
      let symbol_id = binding.symbol_id;
      if self.is_declaration_binding(binding, declaration_node_id)
        && self.symbol_states[symbol_id].is_extracted()
      {
        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
    }
    walk_mut::walk_variable_declarator(self, declarator);
  }

  fn visit_formal_parameter(&mut self, parameter: &mut FormalParameter<'ast>) {
    self.emit_binding_pattern(&parameter.pattern);
    walk_mut::walk_formal_parameter(self, parameter);
  }

  fn visit_catch_parameter(&mut self, parameter: &mut CatchParameter<'ast>) {
    self.emit_binding_pattern(&parameter.pattern);
    walk_mut::walk_catch_parameter(self, parameter);
  }

  fn visit_ts_enum_declaration(&mut self, declaration: &mut TSEnumDeclaration<'ast>) {
    let symbol_id = declaration.id.symbol_id();
    if self.symbol_states[symbol_id].is_extracted() {
      self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
    }
    walk_mut::walk_ts_enum_declaration(self, declaration);
  }

  fn visit_ts_module_declaration(&mut self, declaration: &mut TSModuleDeclaration<'ast>) {
    if let TSModuleDeclarationName::Identifier(identifier) = &declaration.id {
      let symbol_id = identifier.symbol_id();
      if self.symbol_states[symbol_id].is_extracted() {
        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
    }
    walk_mut::walk_ts_module_declaration(self, declaration);
  }

  fn visit_function(&mut self, function: &mut Function<'ast>, flags: ScopeFlags) {
    if matches!(function.r#type, FunctionType::FunctionExpression)
      || self
        .frames
        .iter()
        .any(|frame| frame.flags.is_function() || frame.flags.is_arrow())
    {
      walk_mut::walk_function(self, function, flags);
      return;
    }

    let binding_index = self.frames.last().unwrap().body.len();
    let should_emit_binding = matches!(function.r#type, FunctionType::FunctionDeclaration)
      && function.body.is_some()
      && function
        .id
        .as_ref()
        .is_some_and(|identifier| self.symbol_states[identifier.symbol_id()].is_extracted());

    let preserve_function = self.preserve_source_ast
      || should_emit_binding
        && function.id.as_ref().is_some_and(|identifier| {
          matches!(
            self.symbol_states[identifier.symbol_id()],
            SymbolState::AllowedDirect
          )
        });
    self.with_preserved_ast(preserve_function, |this| {
      walk_mut::walk_function(this, function, flags);
    });

    if should_emit_binding {
      let mut function = function.take_in(self);
      let symbol_id = function.id.as_ref().unwrap().symbol_id();
      let statement = match self.symbol_states[symbol_id] {
        SymbolState::AllowedDirect => {
          let mut rewriter = ReferenceRewriter {
            ast: AstBuilder::new(self.allocator()),
            location_context: self.location_context,
            mode: ExpressionAnalysisMode::Interpolation(None)
              .in_closure(function.scope_id(), function_header_span(&function)),
            scoping: self.scoping,
            symbol_states: self.symbol_states,
          };
          walk_mut::walk_function(&mut rewriter, &mut function, flags);
          Statement::FunctionDeclaration(Box::new_in(function, self))
        }
        SymbolState::RejectedThunk(_) => self.build_function_placeholder_statement(function),
        _ => unreachable!(),
      };
      self.insert_binding_statement(binding_index, statement);
    }
  }

  fn visit_class(&mut self, class: &mut Class<'ast>) {
    if matches!(class.r#type, ClassType::ClassDeclaration)
      && let Some(identifier) = &class.id
    {
      let symbol_id = identifier.symbol_id();
      if self.symbol_states[symbol_id].is_extracted() {
        self.push_binding_statement(self.build_non_owned_symbol_statement(symbol_id));
      }
    }
    walk_mut::walk_class(self, class);
  }
}

pub(crate) fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformOptions,
) -> OxcTransformResult {
  let CompileTimeTransformOptions {
    filename,
    css_sourcemap,
    sourcemap,
  } = options;

  let source_type = SourceType::from_path(&filename).unwrap();

  let allocator = &Allocator::default();
  let ast = AstBuilder::new(allocator);

  let mut ret = Parser::new(allocator, &source_text, source_type)
    .with_options(ParseOptions {
      preserve_parens: false,
      ..ParseOptions::default()
    })
    .parse();
  let (scoping, css_import_symbols, symbol_states) = {
    let semantic = SemanticBuilder::new()
      .with_build_nodes(true)
      .build(&ret.program)
      .semantic;
    let css_import_symbols = CssImportSymbols::collect(allocator, &ret.program);
    let (scoping, nodes) = semantic.into_scoping_and_nodes();

    let mut symbol_states = IndexVec::with_capacity(scoping.symbols_len());
    symbol_states.resize_with(scoping.symbols_len(), || SymbolState::Unseen);
    let mut symbol_states: IndexBox<SymbolId, [SymbolState]> = symbol_states.into_boxed_slice();
    let resolving_symbols = BitSet::new_in(scoping.symbols_len(), &allocator);

    TemplateDiscoveryVisitor {
      symbols: SymbolAnalyzer {
        allocator,
        css_import_symbols: &css_import_symbols,
        nodes: &nodes,
        scoping: &scoping,
        resolving_symbols,
        symbol_states: &mut symbol_states,
      },
    }
    .visit_program(&ret.program);

    (scoping, css_import_symbols, symbol_states)
  };

  let diagnostic_location_context = SourceLocationContext::new(&source_text);

  let mut emitter = CompileTimeEmitter {
    ast: AstBuilder::new(allocator),
    css_sourcemap,
    css_import_symbols: &css_import_symbols,
    filename: &filename,
    frames: Vec::new_in(&ast),
    location_context: &diagnostic_location_context,
    preserve_source_ast: false,
    root_body: Vec::new_in(&ast),
    scoping: &scoping,
    symbol_states: &symbol_states,
  };
  emitter.visit_program(&mut ret.program);

  let finalize = quote_expr!(&ast, __csslit.finalize(null));
  emitter
    .root_body
    .push(quote_stmt!(&ast, export const @{CSSLIT_EVAL_RESULT_NAME} = @{finalize};));

  let mut output_program = Program::new_with_scope_id(
    ret.program.span,
    ret.program.source_type,
    ret.program.source_text,
    ret.program.comments.take_in(&ast),
    ret.program.hashbang.take(),
    ret.program.directives.take_in(&ast),
    emitter.root_body,
    ret.program.scope_id.get().unwrap(),
    &ast,
  );

  if source_type.is_typescript() {
    let scoping = SemanticBuilder::new()
      .with_enum_eval(true)
      .build(&output_program)
      .semantic
      .into_scoping();
    let transform_options = TransformOptions {
      jsx: JsxOptions::disable(),
      ..TransformOptions::default()
    };
    Transformer::new(allocator, Path::new(&filename), &transform_options)
      .build_with_scoping(scoping, &mut output_program);
  }

  let source_map_filename = filename.clone();
  let result = Codegen::new()
    .with_options(CodegenOptions {
      source_map_path: sourcemap.then(|| source_map_filename.into()),
      ..CodegenOptions::default()
    })
    .with_source_text(&source_text)
    .build(&output_program);

  OxcTransformResult {
    code: result.code,
    map: result.map.map(Into::into),
    exports: std::vec::Vec::new(),
  }
}

impl<'alloc, F> ExpressionAnalyzer<'_, 'alloc, F>
where
  F: FnMut(&IdentifierReference) -> Result<bool, Issue<'alloc>>,
{
  fn binding_mutation_issue(&self, identifier: &IdentifierReference, span: Span) -> Issue<'alloc> {
    Issue::BindingMutation {
      code: self.mode.binding_mutation_code(),
      binding: identifier.name.as_str().clone_in(self.allocator),
      declaration: referenced_symbol_id(self.scoping, identifier)
        .map(|symbol_id| self.scoping.symbol_span(symbol_id)),
      closure: self.mode.capturing_closure(),
      span,
    }
  }

  fn analyze(&mut self, expr: &Expression) -> Result<bool, Issue<'alloc>> {
    let mode = self.mode;
    let css_import_symbols = self.css_import_symbols;
    let scoping = self.scoping;
    match expr {
      Expression::BooleanLiteral(_)
      | Expression::NullLiteral(_)
      | Expression::NumericLiteral(_)
      | Expression::BigIntLiteral(_)
      | Expression::RegExpLiteral(_)
      | Expression::StringLiteral(_) => Ok(true),
      Expression::MetaProperty(_) | Expression::ThisExpression(_) => Ok(false),
      Expression::Super(super_expression) => Err(Issue::Expression {
        code: ExpressionCode::SuperExpression,
        span: super_expression.span,
      }),
      Expression::Identifier(ident) => {
        if mode.is_local(ident, scoping) {
          Ok(true)
        } else {
          (self.on_identifier)(ident)
        }
      }
      Expression::AssignmentExpression(assignment) => {
        self.analyze_assignment_target(&assignment.left)?;
        self.analyze(&assignment.right)?;
        Ok(false)
      }
      Expression::UpdateExpression(update) => {
        if let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &update.argument
          && mode.is_writable(ident, scoping)
        {
          Ok(false)
        } else if let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &update.argument {
          Err(self.binding_mutation_issue(ident, update.span))
        } else {
          Err(Issue::Expression {
            code: ExpressionCode::PropertyMutation,
            span: update.span,
          })
        }
      }
      Expression::AwaitExpression(await_expression)
        if matches!(mode, ExpressionAnalysisMode::Interpolation(Some(_))) =>
      {
        self.analyze(&await_expression.argument)?;
        Ok(false)
      }
      Expression::YieldExpression(yield_expression)
        if matches!(mode, ExpressionAnalysisMode::Interpolation(Some(_))) =>
      {
        if let Some(argument) = &yield_expression.argument {
          self.analyze(argument)?;
        }
        Ok(false)
      }
      Expression::TemplateLiteral(template) => {
        let mut is_plain = true;
        for expression in &template.expressions {
          is_plain &= self.analyze(expression)?;
        }
        Ok(is_plain)
      }
      Expression::TaggedTemplateExpression(tagged)
        if css_import_symbols.is_css_with_scoping(&tagged.tag, scoping)
          || css_import_symbols.is_global_css_with_scoping(&tagged.tag, scoping) =>
      {
        Ok(true)
      }
      Expression::ArrayExpression(array) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::dependency(expr),
          span: expr.span(),
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          for element in &array.elements {
            match element {
              ArrayExpressionElement::SpreadElement(spread) => {
                self.analyze(&spread.argument)?;
              }
              ArrayExpressionElement::Elision(_) => {}
              _ => {
                self.analyze(element.to_expression())?;
              }
            }
          }
          Ok(false)
        }
      },
      Expression::ObjectExpression(object) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::dependency(expr),
          span: expr.span(),
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          for property in &object.properties {
            match property {
              ObjectPropertyKind::ObjectProperty(property) => {
                if property.computed
                  && let Some(expression) = property.key.as_expression()
                {
                  self.analyze(expression)?;
                }
                self.analyze(&property.value)?;
              }
              ObjectPropertyKind::SpreadProperty(property) => {
                self.analyze(&property.argument)?;
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
        self.analyze(&call.callee)?;

        if call.arguments.len() != 1 {
          return Err(Issue::Expression {
            code: ExpressionCode::InvalidComptimeCall,
            span: call.span,
          });
        }

        let argument = &call.arguments[0];
        let expression = match argument {
          Argument::SpreadElement(_) => {
            return Err(Issue::Expression {
              code: ExpressionCode::InvalidComptimeCall,
              span: argument.span(),
            });
          }
          _ => argument.to_expression(),
        };

        self.mode = ExpressionAnalysisMode::Interpolation(None);
        let result = self.analyze(expression);
        self.mode = mode;
        result?;
        Ok(false)
      }
      Expression::CallExpression(call) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::CallExpression,
          span: call.span,
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          self.analyze(&call.callee)?;
          for argument in &call.arguments {
            match argument {
              Argument::SpreadElement(spread) => {
                self.analyze(&spread.argument)?;
              }
              _ => {
                self.analyze(argument.to_expression())?;
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
          self.analyze(&unary.argument)
        }
      }
      Expression::BinaryExpression(binary) => {
        let left_plain = self.analyze(&binary.left)?;
        let right_plain = self.analyze(&binary.right)?;
        Ok(
          binary.operator != BinaryOperator::In
            && binary.operator != BinaryOperator::Instanceof
            && left_plain
            && right_plain,
        )
      }
      Expression::LogicalExpression(logical) => {
        let left_plain = self.analyze(&logical.left)?;
        let right_plain = self.analyze(&logical.right)?;
        Ok(left_plain && right_plain)
      }
      Expression::ConditionalExpression(conditional) => {
        let test_plain = self.analyze(&conditional.test)?;
        let consequent_plain = self.analyze(&conditional.consequent)?;
        let alternate_plain = self.analyze(&conditional.alternate)?;
        Ok(test_plain && consequent_plain && alternate_plain)
      }
      Expression::ComputedMemberExpression(member) => {
        self.analyze(&member.object)?;
        self.analyze(&member.expression)?;
        Ok(false)
      }
      Expression::StaticMemberExpression(member) => {
        self.analyze(&member.object)?;
        Ok(false)
      }
      Expression::ChainExpression(chain) => self.analyze_chain(&chain.expression),
      Expression::TSAsExpression(expression) => self.analyze(&expression.expression),
      Expression::TSSatisfiesExpression(expression) => self.analyze(&expression.expression),
      Expression::TSTypeAssertion(expression) => self.analyze(&expression.expression),
      Expression::TSNonNullExpression(expression) => self.analyze(&expression.expression),
      Expression::TSInstantiationExpression(expression) => self.analyze(&expression.expression),
      Expression::NewExpression(new_expr) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::NewExpression,
          span: new_expr.span,
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          self.analyze(&new_expr.callee)?;
          for argument in &new_expr.arguments {
            match argument {
              Argument::SpreadElement(spread) => {
                self.analyze(&spread.argument)?;
              }
              _ => {
                self.analyze(argument.to_expression())?;
              }
            }
          }
          Ok(false)
        }
      },
      Expression::TaggedTemplateExpression(tagged) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::TaggedTemplate,
          span: tagged.span,
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          self.analyze(&tagged.tag)?;
          for expression in &tagged.quasi.expressions {
            self.analyze(expression)?;
          }
          Ok(false)
        }
      },
      Expression::SequenceExpression(sequence) => match mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::SequenceExpression,
          span: sequence.span,
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          let mut is_plain = true;
          for expression in &sequence.expressions {
            is_plain &= self.analyze(expression)?;
          }
          Ok(is_plain)
        }
      },
      Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
        let (scope_id, start) = match expr {
          Expression::ArrowFunctionExpression(arrow) => {
            (arrow.scope_id(), arrow_closure_start_span(arrow))
          }
          Expression::FunctionExpression(function) => {
            (function.scope_id(), function_header_span(function))
          }
          _ => unreachable!(),
        };
        self.mode = mode.in_closure(scope_id, start);
        let result = {
          let mut body = ClosureBodyAnalyzer {
            expressions: self,
            result: Ok(()),
          };
          oxc_ast_visit::walk::walk_expression(&mut body, expr);
          body.result
        };
        self.mode = mode;
        result.map(|()| false)
      }
      Expression::ClassExpression(class) => Err(Issue::Expression {
        code: ExpressionCode::ClassExpression,
        span: class_header_span(class),
      }),
      _ => Err(Issue::Expression {
        code: ExpressionCode::dependency(expr),
        span: expr.span(),
      }),
    }
  }

  fn analyze_assignment_target(&mut self, target: &AssignmentTarget) -> Result<(), Issue<'alloc>> {
    let mut body = ClosureBodyAnalyzer {
      expressions: self,
      result: Ok(()),
    };
    body.visit_assignment_target(target);
    body.result
  }

  fn analyze_chain(&mut self, chain: &ChainElement) -> Result<bool, Issue<'alloc>> {
    match chain {
      ChainElement::CallExpression(call) => match self.mode {
        ExpressionAnalysisMode::Binding => Err(Issue::Expression {
          code: ExpressionCode::CallExpression,
          span: call.span,
        }),
        ExpressionAnalysisMode::Interpolation(_) => {
          self.analyze(&call.callee)?;
          for argument in &call.arguments {
            match argument {
              Argument::SpreadElement(spread) => {
                self.analyze(&spread.argument)?;
              }
              _ => {
                self.analyze(argument.to_expression())?;
              }
            }
          }
          Ok(false)
        }
      },
      ChainElement::ComputedMemberExpression(member) => {
        self.analyze(&member.object)?;
        self.analyze(&member.expression)?;
        Ok(false)
      }
      ChainElement::StaticMemberExpression(member) => {
        self.analyze(&member.object)?;
        Ok(false)
      }
      ChainElement::PrivateFieldExpression(member) => Err(Issue::Expression {
        code: ExpressionCode::PrivateField,
        span: member.span,
      }),
      ChainElement::TSNonNullExpression(expression) => self.analyze(&expression.expression),
    }
  }
}

struct ReferenceRewriter<'ctx, 'alloc> {
  ast: AstBuilder<'alloc>,
  location_context: &'ctx SourceLocationContext<'alloc>,
  mode: ExpressionAnalysisMode,
  scoping: &'ctx Scoping,
  symbol_states: &'ctx IndexSlice<SymbolId, [SymbolState<'alloc>]>,
}

impl<'alloc> GetAstBuilder<'alloc> for ReferenceRewriter<'_, 'alloc> {
  type Builder = AstBuilder<'alloc>;

  fn builder(&self) -> &Self::Builder {
    &self.ast
  }
}

impl<'alloc> GetAllocator<'alloc> for ReferenceRewriter<'_, 'alloc> {
  fn allocator(&self) -> &'alloc Allocator {
    self.ast.allocator()
  }
}

impl<'alloc> ReferenceRewriter<'_, 'alloc> {
  fn rewrite_identifier(&self, expression: &mut Expression<'alloc>, symbol_id: SymbolId) {
    let Expression::Identifier(identifier) = expression else {
      unreachable!();
    };

    let callee = identifier.name;
    *expression = match &self.symbol_states[symbol_id] {
      SymbolState::AllowedDirect | SymbolState::Import | SymbolState::Unseen => return,
      SymbolState::AllowedThunk | SymbolState::RejectedThunk(_) => {
        let location = self
          .location_context
          .runtime_location_expression(self, identifier.span);
        quote_expr!(self, @{callee}(@{location}))
      }
      state @ (SymbolState::AllowedCallMemo { .. } | SymbolState::RejectedCallMemo(_)) => {
        let use_span = identifier.span;
        let name = identifier.name.as_str();
        let init_span = match state {
          SymbolState::AllowedCallMemo { decl_span } => *decl_span,
          SymbolState::RejectedCallMemo(info) => info.decl_span.unwrap(),
          _ => unreachable!(),
        };
        let use_location = self
          .location_context
          .runtime_location_expression(self, use_span);
        let init_location = self
          .location_context
          .runtime_location_expression(self, init_span);
        quote_expr!(
          self,
          use_span,
          __csslit.readCell(@{name}, @{callee}, @{use_location}, @{init_location})
        )
      }
    };
  }
}

impl<'ctx, 'alloc> VisitMut<'alloc> for ReferenceRewriter<'ctx, 'alloc> {
  fn visit_expression(&mut self, expression: &mut Expression<'alloc>) {
    if let Expression::Identifier(identifier) = expression {
      if self.mode.is_local(identifier, self.scoping) {
        return;
      }
      let Some(symbol_id) = referenced_symbol_id(self.scoping, identifier) else {
        return;
      };
      self.rewrite_identifier(expression, symbol_id);
      return;
    }

    walk_mut::walk_expression(self, expression);
  }

  fn visit_arrow_function_expression(&mut self, expression: &mut ArrowFunctionExpression<'alloc>) {
    let mode = self.mode;
    self.mode = mode.in_closure(expression.scope_id(), arrow_closure_start_span(expression));
    walk_mut::walk_arrow_function_expression(self, expression);
    self.mode = mode;
  }

  fn visit_function(&mut self, function: &mut Function<'alloc>, flags: ScopeFlags) {
    let mode = self.mode;
    self.mode = mode.in_closure(function.scope_id(), function_header_span(function));
    walk_mut::walk_function(self, function, flags);
    self.mode = mode;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn compile(source: &str) -> String {
    compile_with_css_sourcemap(source, false)
  }

  fn compile_with_css_sourcemap(source: &str, css_sourcemap: bool) -> String {
    let mut output = transform_compile_time(
      source.to_string(),
      CompileTimeTransformOptions {
        filename: "/src/example.tsx".to_string(),
        css_sourcemap,
        sourcemap: false,
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
  fn emits_quasi_content_locations_only_for_css_sourcemaps() {
    let source = "import { css } from \"@csslit/core\";\ncss`ab${value}\ncd`;";
    let without_map = compile_with_css_sourcemap(source, false);
    let with_map = compile_with_css_sourcemap(source, true);

    assert!(without_map.contains("__csslit.css("));
    assert!(
      with_map.contains(", [\n  1,\n  4,\n  1,\n  14\n])"),
      "{with_map}"
    );
  }

  #[test]
  fn supports_new_tagged_template_and_sequence_interpolations() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";
        import { dedent } from "./tags";

        const scale = 4;
        css`
          width: ${new Intl.NumberFormat("en").format(scale)}px;
          content: ${dedent`a ${scale} b`};
          height: ${(0, scale)}px;
        `;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { dedent } from "./tags";
        const scale = 4;
        __csslit.css("aKU63j_6_9")`
                  width: ${__csslit.capture("6:19:6:60", () => new Intl.NumberFormat("en").format(scale))}px;
                  content: ${__csslit.capture("7:21:7:41", () => dedent`a ${scale} b`)};
                  height: ${0, scale}px;
                `;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn snapshots_top_level_binding_rewrite() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";
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
        const tone = __csslit.cell("tone", "4:21:4:35", () => color ?? "red");
        __csslit.css("aKU63j_6_9")`color: ${__csslit.capture("5:21:5:25", () => tone("5:21:5:25"))}; border-color: ${__csslit.capture("5:44:5:63", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn snapshots_deferred_scope_and_rejected_param() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

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
          const param = __csslit.cellVarErr("param", "runtime-parameter", "5:22:5:35");
          const local = outer + 1;
          __csslit.css("PJY18l_8_11")`width: ${local}px; height: ${__csslit.capture("7:43:7:48", () => param("7:43:7:48"))}px;`;
        });
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn keeps_only_used_imports_and_allows_globals() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";
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
        const tone = __csslit.cell("tone", "4:21:4:55", () => color ?? globalThis.theme.fallback);
        __csslit.css("aKU63j_6_9")`color: ${__csslit.capture("5:21:5:25", () => tone("5:21:5:25"))}; border-color: ${__csslit.capture("5:44:5:63", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_mutated_and_supports_destructured_locals() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";
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
        import { theme } from "./theme";
        const tone = __csslit.cellVarErr("tone", "reassigned", "5:8:5:12");
        const border = __csslit.cell("border", "7:14:7:24");
        __csslit.destructure([border], "7:27:7:32", () => theme, (__csslit_destructure_value_158) => ({border: border.value} = __csslit_destructure_value_158));
        __csslit.css("HAXkGd_9_9")`color: ${__csslit.capture("8:21:8:25", () => tone("8:21:8:25"))}; border-width: ${__csslit.capture("8:44:8:50", () => border("8:44:8:50"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_nested_destructuring_computed_keys_and_defaults() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";
        import { fallback, key, theme, values } from "./theme";

        const {
          [key]: tone = fallback,
          nested: { border = `${fallback}px` },
          ...rest
        } = theme;
        const [first = "red", second = first] = values;
        css`color: ${tone}; border-width: ${border}; opacity: ${rest.opacity}; background: ${second};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { fallback, key, theme, values } from "./theme";
        const tone = __csslit.cell("tone", "4:14:8:9");
        const border = __csslit.cell("border", "4:14:8:9");
        const rest = __csslit.cell("rest", "4:14:8:9");
        __csslit.destructure([
          tone,
          border,
          rest
        ], "8:12:8:17", () => theme, (__csslit_destructure_value_124) => ({[key]: tone.value = fallback, nested: {border: border.value = `${fallback}px`}, ...rest.value} = __csslit_destructure_value_124));
        const first = __csslit.cell("first", "9:14:9:45");
        const second = __csslit.cell("second", "9:14:9:45");
        __csslit.destructure([first, second], "9:48:9:54", () => values, (__csslit_destructure_value_259) => [first.value = "red", second.value = first("9:39:9:44")] = __csslit_destructure_value_259);
        __csslit.css("vGnKZk_11_9")`color: ${__csslit.capture("10:21:10:25", () => tone("10:21:10:25"))}; border-width: ${__csslit.capture("10:44:10:50", () => border("10:44:10:50"))}; opacity: ${__csslit.capture("10:64:10:76", () => rest("10:64:10:68").opacity)}; background: ${__csslit.capture("10:93:10:99", () => second("10:93:10:99"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn discards_unused_destructuring_bindings_without_cells() {
    let output = compile(
      "import { comptime, css } from \"@csslit/core\";\n\nconst { first, unused = first, used } = comptime({ used: \"blue\" });\ncss`color: ${used};`;",
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { comptime } from "@csslit/core";
        const used = __csslit.cell("used", "2:6:2:37");
        __csslit.destructure([used], "2:40:2:66", () => comptime({ used: "blue" }), (__csslit_destructure_value_53) => ({used: used.value} = __csslit_destructure_value_53));
        __csslit.css("i6DBvI_4_1")`color: ${__csslit.capture("3:13:3:17", () => used("3:13:3:17"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn retains_discard_target_for_live_object_rest() {
    let output = compile(
      "import { comptime, css } from \"@csslit/core\";\n\nconst { unused, ...rest } = comptime({ unused: \"red\", used: \"blue\" });\ncss`color: ${rest.used};`;",
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { comptime } from "@csslit/core";
        const rest = __csslit.cell("rest", "2:6:2:25");
        __csslit.destructure([rest], "2:28:2:69", () => comptime({
          unused: "red",
          used: "blue"
        }), (__csslit_destructure_value_53) => ({unused: __csslit.discard, ...rest.value} = __csslit_destructure_value_53));
        __csslit.css("i6DBvI_4_1")`color: ${__csslit.capture("3:13:3:22", () => rest("3:13:3:17").used)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_var_bindings_via_read_cell() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

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
        var legacy = __csslit.cell("legacy", "3:21:3:26", () => "red");
        const stable = "1px";
        __csslit.css("GEZhd6_7_9")`color: ${__csslit.capture("6:21:6:27", () => __csslit.readCell("legacy", legacy, "6:21:6:27", "3:12:3:26"))}; border-width: ${stable};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_var_reads_before_initializer_via_read_cell() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        css`color: ${legacy};`;
        var legacy = "red";
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css("QTVSqU_4_9")`color: ${__csslit.capture("3:21:3:27", () => __csslit.readCell("legacy", legacy, "3:21:3:27", "4:12:4:26"))};`;
        var legacy = __csslit.cell("legacy", "4:21:4:26", () => "red");
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_var_redeclarations() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        var value = { value: "red", other: "blue" };
        var { value, other } = value;
        css`color: ${value}; background: ${other};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        var value = __csslit.cellVarErr("value", "reassigned", "4:14:4:19");
        var other = __csslit.cell("other", "4:12:4:28");
        __csslit.destructure([other], "4:31:4:36", () => __csslit.readCell("value", value, "4:31:4:36", "3:12:3:51"), (__csslit_destructure_value_111) => ({other: other.value} = __csslit_destructure_value_111));
        __csslit.css("aKU63j_6_9")`color: ${__csslit.capture("5:21:5:26", () => __csslit.readCell("value", value, "5:21:5:26", "3:12:3:51"))}; background: ${__csslit.capture("5:43:5:48", () => __csslit.readCell("other", other, "5:43:5:48", "4:12:4:36"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn emits_only_the_first_duplicate_var_binding() {
    let output = compile(
      "import { css } from \"@csslit/core\";\n\nvar { color, color } = { color: \"hotpink\" };\ncss`color: ${color};`;",
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        var color = __csslit.cellVarErr("color", "reassigned", "2:13:2:18");
        __csslit.css("i6DBvI_4_1")`color: ${__csslit.capture("3:13:3:18", () => __csslit.readCell("color", color, "3:13:3:18", "2:4:2:43"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_uninitialized_var_redeclarations() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        var value = "red";
        var value;
        css`color: ${value};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        var value = __csslit.cellVarErr("value", "reassigned", "4:12:4:17");
        __csslit.css("aKU63j_6_9")`color: ${__csslit.capture("5:21:5:26", () => __csslit.readCell("value", value, "5:21:5:26", "3:12:3:25"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn rejects_unsupported_interpolations_without_aborting_capture() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

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
        __csslit.css("bmUxWS_5_9")`color: ${tone}; width: ${__csslit.capture("4:37:4:47", () => pickSize())}px; border-color: ${__csslit.capture("4:68:4:87", () => window.theme.border)};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn flattens_non_deferred_scope_without_local_bindings() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

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
        __csslit.css("CNgLnJ_5_11")`color: red;`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn css_binding_initializers_emit_class_name_string() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        const appStyle = css`color: red;`;
        css`.${appStyle} & { color: blue; }`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css("VebxKp_4_26")`color: red;`;
        const appStyle = "__csslit_class_VebxKp_4_26";
        __csslit.css("bmUxWS_5_9")`.${appStyle} & { color: blue; }`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn css_expressions_emit_class_name_strings() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        const useFoo = true;
        const appStyle = useFoo ? css`color: red;` : css`color: blue;`;
        css`.${appStyle} & { color: hotpink; }`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        const useFoo = true;
        __csslit.css("glNCrI_5_35")`color: red;`;
        __csslit.css("wnfmD7_5_54")`color: blue;`;
        const appStyle = useFoo ? "__csslit_class_glNCrI_5_35" : "__csslit_class_wnfmD7_5_54";
        __csslit.css("aKU63j_6_9")`.${appStyle} & { color: hotpink; }`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn preserves_closure_while_extracting_nested_css() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        css`.${(() => {
          const color = "red";
          return css`color: ${color};`;
        })()} & { color: blue; }`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.defer(() => {
          const color = "red";
          __csslit.css("PYapLP_6_18")`color: ${color};`;
        });
        __csslit.css("QTVSqU_4_9")`.${__csslit.capture("3:15:6:12", () => (() => {
          const color = "red";
          return "__csslit_class_PYapLP_6_18";
        })())} & { color: blue; }`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn preserves_destructuring_while_extracting_nested_css() {
    let output = compile(
      r#"
        import { comptime, css } from "@csslit/core";

        css`.${(() => {
          const { inner = css`color: red;` } = comptime({});
          return css`.${inner} & { color: blue; }`;
        })()} & { color: green; }`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        import { comptime } from "@csslit/core";
        __csslit.defer(() => {
          __csslit.css("W2kfCu_5_27")`color: red;`;
          const inner = __csslit.cell("inner", "4:16:4:44");
          __csslit.destructure([inner], "4:47:4:59", () => comptime({}), (__csslit_destructure_value_96) => ({inner: inner.value = "__csslit_class_W2kfCu_5_27"} = __csslit_destructure_value_96));
          __csslit.css("PYapLP_6_18")`.${__csslit.capture("5:24:5:29", () => inner("5:24:5:29"))} & { color: blue; }`;
        });
        __csslit.css("QTVSqU_4_9")`.${__csslit.capture("3:15:6:12", () => (() => {
          const { inner = "__csslit_class_W2kfCu_5_27" } = comptime({});
          return "__csslit_class_PYapLP_6_18";
        })())} & { color: green; }`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn supports_hoisted_function_declarations() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        css`color: ${pick()};`;

        function pick(): string {
          return "red";
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css("QTVSqU_4_9")`color: ${__csslit.capture("3:21:3:27", () => pick())};`;
        function pick() {
          return "red";
        }
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn preserves_function_declarations_while_extracting_nested_css() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        css`.${pick()} & { color: blue; }`;

        function pick() {
          const color = "red";
          return css`color: ${color};`;
        }
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css("QTVSqU_4_9")`.${__csslit.capture("3:15:3:21", () => pick())} & { color: blue; }`;
        function pick() {
          const color = "red";
          return "__csslit_class_HVn7ul_8_18";
        }
        __csslit.defer(() => {
          const color = "red";
          __csslit.css("HVn7ul_8_18")`color: ${color};`;
        });
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn ambient_functions_are_treated_as_globals() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

        declare function parseInt(value: string): number;
        css`z-index: ${parseInt("1")};`;
      "#,
    );

    assert_snapshot(
      &output,
      r#"
        import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
        const __csslit = __csslit_eval_runtime.init();
        __csslit.css("bmUxWS_5_9")`z-index: ${__csslit.capture("4:23:4:36", () => parseInt("1"))};`;
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }

  #[test]
  fn class_bindings_throw_via_cell_var_err() {
    let output = compile(
      r#"
        import { css } from "@csslit/core";

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
        __csslit.css("QTVSqU_4_9")`color: ${__csslit.capture("3:21:3:26", () => Theme("3:21:3:26"))};`;
        const Theme = __csslit.cellVarErr("Theme", "class-binding", "5:14:5:19");
        export const __csslit_eval_result = __csslit.finalize(null);
      "#,
    );
  }
}
