use crate::{CompileTimeTransformOptions, RuntimeTransformOptions, quote_expr, quote_stmt};
use oxc_allocator::{Allocator, CloneIn, Vec};
use oxc_ast::{
  AstBuilder, NONE,
  ast::{Expression, ImportDeclarationSpecifier, Program, Statement, TemplateLiteral},
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_sourcemap::Token;
use oxc_span::{GetSpan, SPAN, SourceType};
use oxc_syntax::symbol::SymbolId;
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};
use rolldown_sourcemap::{JSONSourceMap, SourceMap, collapse_sourcemaps};
use std::path::Path;

use super::{RawSourceMap, TransformResult};

struct CssImportSymbols<'a> {
  named: Vec<'a, SymbolId>,
  namespaces: Vec<'a, SymbolId>,
}

impl CssImportSymbols<'_> {
  fn collect<'a>(allocator: &'a Allocator, program: &Program<'a>) -> CssImportSymbols<'a> {
    let imports = program.body.iter().filter_map(|statement| {
      if let Statement::ImportDeclaration(import) = statement
        && import.source.value == "csslit"
        && import.import_kind.is_value()
      {
        Some(import)
      } else {
        None
      }
    });

    CssImportSymbols {
      named: Vec::from_iter_in(
        imports
          .clone()
          .flat_map(|import| import.specifiers.iter().flatten())
          .filter_map(|specifier| match specifier {
            ImportDeclarationSpecifier::ImportSpecifier(specifier)
              if specifier.import_kind.is_value() && specifier.imported.name() == "css" =>
            {
              Some(specifier.local.symbol_id())
            }
            _ => None,
          }),
        allocator,
      ),
      namespaces: Vec::from_iter_in(
        imports
          .clone()
          .flat_map(|import| import.specifiers.iter().flatten())
          .filter_map(|specifier| match specifier {
            ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
              Some(specifier.local.symbol_id())
            }
            _ => None,
          }),
        allocator,
      ),
    }
  }

  fn is_css(&self, tag: &Expression<'_>, ctx: &TraverseCtx<'_, ()>) -> bool {
    match tag {
      Expression::Identifier(ident) => ctx
        .scoping()
        .get_reference(ident.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| self.named.contains(&symbol_id)),
      Expression::StaticMemberExpression(member) if member.property.name == "css" => member
        .object
        .get_identifier_reference()
        .and_then(|ident| {
          ctx
            .scoping()
            .get_reference(ident.reference_id())
            .symbol_id()
        })
        .is_some_and(|symbol_id| self.namespaces.contains(&symbol_id)),
      _ => false,
    }
  }
}

impl TryFrom<RawSourceMap> for SourceMap {
  type Error = oxc_sourcemap::Error;

  fn try_from(map: RawSourceMap) -> Result<Self, Self::Error> {
    SourceMap::from_json(JSONSourceMap {
      version: map.version,
      file: map.file,
      mappings: map.mappings,
      source_root: map.source_root,
      sources: map.sources,
      sources_content: map.sources_content,
      names: map.names,
      debug_id: map.debug_id,
      x_google_ignore_list: map.x_google_ignore_list,
    })
  }
}

impl From<SourceMap> for RawSourceMap {
  fn from(map: SourceMap) -> Self {
    let json = map.to_json();
    Self {
      file: json.file,
      mappings: json.mappings,
      names: json.names,
      source_root: json.source_root,
      sources: json.sources,
      sources_content: json.sources_content,
      version: json.version,
      x_google_ignore_list: json.x_google_ignore_list,
      debug_id: json.debug_id,
    }
  }
}

#[derive(Clone)]
pub(crate) struct OffsetSpan {
  pub(crate) start: u32,
}

pub(crate) struct CssBlockMetadata<'a> {
  pub(crate) quasis: Vec<'a, OffsetSpan>,
  pub(crate) expressions: Vec<'a, OffsetSpan>,
}

pub(crate) struct SourceLocation<'a> {
  pub(crate) source: &'a str,
  pub(crate) line: u32,
  pub(crate) column: u32,
}

pub(crate) struct CssTemplateBlock<'a> {
  pub(crate) template: TemplateLiteral<'a>,
  pub(crate) metadata: CssBlockMetadata<'a>,
}

pub(crate) struct SourceRemapContext<'a> {
  source_rope: Rope,
  lookup_table: Option<std::vec::Vec<&'a [Token]>>,
  source_text: &'a str,
  filename: &'a str,
  input_map: Option<&'a SourceMap>,
  referenced_source_ids: Vec<'a, u32>,
  referenced_self_source: bool,
}

impl<'a> SourceRemapContext<'a> {
  pub(crate) fn new(
    allocator: &'a Allocator,
    source_text: &'a str,
    filename: &'a str,
    input_map: Option<&'a SourceMap>,
  ) -> Self {
    Self {
      source_rope: Rope::from_str(source_text),
      lookup_table: input_map.map(SourceMap::generate_lookup_table),
      source_text,
      filename,
      input_map,
      referenced_source_ids: Vec::new_in(allocator),
      referenced_self_source: false,
    }
  }

  fn record_source_id(&mut self, source_id: u32) {
    if !self.referenced_source_ids.contains(&source_id) {
      self.referenced_source_ids.push(source_id);
    }
  }

  pub(crate) fn remap(&mut self, span: OffsetSpan) -> SourceLocation<'a> {
    let (line, column) = get_line_column(&self.source_rope, span.start, self.source_text);

    if let Some(map) = self.input_map
      && let Some(table) = self.lookup_table.as_deref()
      && let Some(token) = map.lookup_token(table, line, column)
      && let Some(source_id) = token.get_source_id()
      && let Some(source) = map.get_source(source_id)
    {
      self.record_source_id(source_id);
      return SourceLocation {
        source: source.as_ref(),
        line: token.get_src_line() + 1,
        column: token.get_src_col(),
      };
    }

    self.referenced_self_source = true;
    SourceLocation {
      source: self.filename,
      line: line + 1,
      column,
    }
  }

  pub(crate) fn source_contents(&self) -> impl Iterator<Item = (&'a str, Option<&'a str>)> + '_ {
    self
      .input_map
      .into_iter()
      .flat_map(|map| {
        self
          .referenced_source_ids
          .iter()
          .filter_map(move |source_id| {
            map.get_source(*source_id).map(|source| {
              (
                source.as_ref(),
                map
                  .get_source_content(*source_id)
                  .map(|content| content.as_ref()),
              )
            })
          })
      })
      .chain(
        self
          .referenced_self_source
          .then_some((self.filename, Some(self.source_text))),
      )
  }
}

pub(crate) struct CompileTimeVisitor<'a> {
  pub blocks: Vec<'a, CssTemplateBlock<'a>>,
  css_import_symbols: CssImportSymbols<'a>,
}

impl<'a> Traverse<'a, ()> for CompileTimeVisitor<'a> {
  fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
    if let Expression::TaggedTemplateExpression(tagged) = expr
      && self.css_import_symbols.is_css(&tagged.tag, ctx)
    {
      self.blocks.push(CssTemplateBlock {
        template: tagged.quasi.clone_in(ctx.ast.allocator),
        metadata: CssBlockMetadata {
          quasis: Vec::from_iter_in(
            tagged.quasi.quasis.iter().map(|quasi| OffsetSpan {
              start: quasi.span.start,
            }),
            ctx.ast.allocator,
          ),
          expressions: Vec::from_iter_in(
            tagged
              .quasi
              .expressions
              .iter()
              .map(|expression| OffsetSpan {
                start: expression.span().start,
              }),
            ctx.ast.allocator,
          ),
        },
      });
      *expr = quote_expr!(ctx.ast, "");
    }
  }
}

pub(crate) struct RuntimeTransformer<'a> {
  pub(crate) has_css: bool,
  pub(crate) index: u32,
  css_import_symbols: CssImportSymbols<'a>,
}

impl<'a> Traverse<'a, ()> for RuntimeTransformer<'a> {
  fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
    match expr {
      Expression::TaggedTemplateExpression(tagged)
        if self.css_import_symbols.is_css(&tagged.tag, ctx) =>
      {
        let index = self.index;
        self.index += 1;
        self.has_css = true;
        *expr = quote_expr!(ctx.ast, __css_module_import.@"csslit_{index}");
      }
      _ => {}
    }
  }
}

pub(crate) fn transform_runtime(
  source_text: String,
  options: RuntimeTransformOptions,
) -> TransformResult {
  let source_type = SourceType::from_path(&options.filename)
    .unwrap_or_default()
    .with_typescript(true)
    .with_jsx(true);

  let allocator = &Allocator::default();

  let ret = Parser::new(allocator, &source_text, source_type).parse();
  let mut program = ret.program;

  let semantic = SemanticBuilder::new().build(&program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &program);
  let scoping = semantic.into_scoping();
  let self_import = Path::new(&options.filename)
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or(&options.filename);

  let mut transformer = RuntimeTransformer {
    has_css: false,
    index: 0,
    css_import_symbols,
  };

  traverse_mut(&mut transformer, allocator, &mut program, scoping, ());

  if transformer.has_css {
    let ast = AstBuilder::new(allocator);
    program.body.insert(
      0,
      quote_stmt!(ast, import __css_module_import from @"./{self_import}.csslit.module.css";),
    );
  }

  let result = Codegen::new()
    .with_options(CodegenOptions {
      source_map_path: options
        .sourcemap
        .then(|| options.filename.to_string().into()),
      ..CodegenOptions::default()
    })
    .with_source_text(&source_text)
    .build(&program);

  TransformResult {
    code: result.code,
    map: result.map.map(Into::into),
  }
}

pub(crate) fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformOptions,
) -> TransformResult {
  let source_type = SourceType::from_path(&options.filename)
    .unwrap_or_default()
    .with_typescript(true)
    .with_jsx(true);

  let allocator = &Allocator::default();

  let mut ret = Parser::new(allocator, &source_text, source_type).parse();
  let semantic = SemanticBuilder::new().build(&ret.program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &ret.program);
  let scoping = semantic.into_scoping();

  let mut visitor = CompileTimeVisitor {
    blocks: Vec::new_in(allocator),
    css_import_symbols,
  };

  traverse_mut(&mut visitor, allocator, &mut ret.program, scoping, ());

  let mut remap_context = options.sourcemap.then(|| {
    SourceRemapContext::new(
      allocator,
      &source_text,
      &options.filename,
      options.input_map.as_ref(),
    )
  });

  let ast = AstBuilder::new(allocator);

  let original_body = ret.program.body;

  ret.program.body = ast.vec_with_capacity(
    1 // runtime
    + original_body
      .iter()
      .filter(|statement| matches!(statement, Statement::ImportDeclaration(_)))
      .count()
      + 1, // export
  );

  ret.program.body.push(quote_stmt!(
    ast,
    const __csslit_extract = (block => (strings, ...values) => ({
      block,
      strings,
      values,
    }));
  ));

  ret.program.body.extend(
    original_body
      .into_iter()
      .filter(|statement| matches!(statement, Statement::ImportDeclaration(_))),
  );

  let blocks = ast.vec_from_iter(visitor.blocks.into_iter().map(|block| {
    let block_metadata = remap_context
      .as_mut()
      .map(|context| {
        let quasis = ast.vec_from_iter(
          block
            .metadata
            .quasis
            .into_iter()
            .map(|quasi| context.remap(quasi))
            .map(
              |SourceLocation {
                 source,
                 line,
                 column,
               }| {
                quote_expr!(ast, {
                  source: @{source},
                  line: @{line},
                  column: @{column},
                })
              },
            ),
        );

        let expressions = ast.vec_from_iter(
          block
            .metadata
            .expressions
            .into_iter()
            .map(|expression| context.remap(expression))
            .map(
              |SourceLocation {
                 source,
                 line,
                 column,
               }| {
                quote_expr!(ast, {
                  source: @{source},
                  line: @{line},
                  column: @{column},
                })
              },
            ),
        );

        quote_expr!(ast, {
          quasis: @{quasis},
          expressions: @{expressions},
        })
      })
      .unwrap_or_else(|| quote_expr!(ast, null));

    ast.expression_tagged_template(
      SPAN,
      quote_expr!(ast, __csslit_extract(@{block_metadata})),
      NONE,
      block.template,
    )
  }));

  let source_contents = match remap_context {
    None => quote_expr!(ast, null),
    Some(context) => {
      let entries =
        ast.vec_from_iter(
          context
            .source_contents()
            .map(|(source, content)| match content {
              None => quote_expr!(ast, [@{source}, null]),
              Some(content) => quote_expr!(ast, [@{source}, @{content}]),
            }),
        );

      quote_expr!(ast, @{entries})
    }
  };

  ret.program.body.push(quote_stmt!(
    ast,
    export const __csslit_eval_result = ({
      blocks: @{blocks},
      source_contents: @{source_contents},
    });
  ));

  let result = Codegen::new()
    .with_options(CodegenOptions {
      source_map_path: options
        .sourcemap
        .then(|| options.filename.to_string().into()),
      ..CodegenOptions::default()
    })
    .with_source_text(&source_text)
    .build(&ret.program);

  TransformResult {
    code: result.code,
    map: result
      .map
      .map(|transform_map| match options.input_map.as_ref() {
        Some(input_map) => collapse_sourcemaps(&[input_map, &transform_map]).into(),
        None => transform_map.into(),
      }),
  }
}
