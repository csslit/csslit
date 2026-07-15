use crate::{CsslitClassExport, RuntimeTransformOptions, quote_expr, quote_stmt};
use oxc_allocator::Allocator;
use oxc_ast::{ast::Expression, builder::AstBuilder};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};

use super::shared::{CssImportSymbols, stable_name_hash};
use crate::OxcTransformResult;

struct RuntimeTransformer<'a> {
  has_css: bool,
  has_global_css: bool,
  exports: Vec<CsslitClassExport>,
  css_import_symbols: CssImportSymbols<'a>,
  source_rope: Rope,
  source_text: &'a str,
  filename: &'a str,
}

impl<'a> Traverse<'a, ()> for RuntimeTransformer<'a> {
  fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
    match expr {
      Expression::TaggedTemplateExpression(tagged)
        if self.css_import_symbols.is_css(&tagged.tag, ctx) =>
      {
        let (line, column) =
          get_line_column(&self.source_rope, tagged.span.start, self.source_text);
        let local_line = line + 1;
        let local_column = column + 1;
        let local_name = format!("css_{local_line}_{local_column}");
        let scoped_name = format!(
          "{}_{}_{}",
          stable_name_hash(self.filename, line, column),
          local_line,
          local_column
        );
        self.has_css = true;
        self.exports.push(CsslitClassExport {
          local_name,
          scoped_name,
        });
        *expr = quote_expr!(ctx, __css_module_import.@"css_{local_line}_{local_column}");
      }
      Expression::TaggedTemplateExpression(tagged)
        if self.css_import_symbols.is_global_css(&tagged.tag, ctx) =>
      {
        self.has_global_css = true;
        *expr = quote_expr!(ctx, undefined);
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
  .with_options(ParseOptions {
    preserve_parens: false,
    ..ParseOptions::default()
  })
  .parse();

  let mut program = ret.program;

  let semantic = SemanticBuilder::new().build(&program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &program);

  let mut transformer = RuntimeTransformer {
    has_css: false,
    has_global_css: false,
    exports: Vec::new(),
    css_import_symbols,
    filename: &options.filename,
    source_rope: Rope::from_str(&source_text),
    source_text: &source_text,
  };

  let scoping = semantic.into_scoping();
  traverse_mut(&mut transformer, allocator, &mut program, scoping, ());

  if transformer.has_css {
    let ast = AstBuilder::new(allocator);
    let module_import = options.module_import.clone();
    program.body.insert(
      0,
      quote_stmt!(ast, import __css_module_import from @"{module_import}";),
    );
  } else if transformer.has_global_css {
    let ast = AstBuilder::new(allocator);
    let module_import = options.module_import.clone();
    program
      .body
      .insert(0, quote_stmt!(ast, import @{module_import};));
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
    map: result.map.map(Into::into),
    exports: transformer.exports,
  }
}
