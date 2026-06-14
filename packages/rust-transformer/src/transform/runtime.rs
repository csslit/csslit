use crate::{RuntimeTransformOptions, quote_expr, quote_stmt};
use oxc_allocator::Allocator;
use oxc_ast::{AstBuilder, ast::Expression};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};

use super::shared::CssImportSymbols;
use crate::OxcTransformResult;

struct RuntimeTransformer<'a> {
  has_css: bool,
  index: u32,
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
) -> OxcTransformResult {
  let allocator = &Allocator::default();

  let ret = Parser::new(
    allocator,
    &source_text,
    SourceType::from_path(&options.filename).unwrap(),
  )
  .parse();

  let mut program = ret.program;

  let semantic = SemanticBuilder::new().build(&program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &program);

  let mut transformer = RuntimeTransformer {
    has_css: false,
    index: 0,
    css_import_symbols,
  };

  let scoping = semantic.into_scoping();
  traverse_mut(&mut transformer, allocator, &mut program, scoping, ());

  if transformer.has_css {
    let ast = AstBuilder::new(allocator);
    let css_import = options.css_import;
    program.body.insert(
      0,
      quote_stmt!(ast, import __css_module_import from @"{css_import}";),
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

  OxcTransformResult {
    code: result.code,
    map: result.map,
  }
}
