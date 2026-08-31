use crate::{CsslitClassExport, RuntimeTransformOptions, quote_expr, quote_stmt};
use oxc_allocator::Allocator;
use oxc_ast::{ast::Expression, builder::AstBuilder};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::SemanticBuilder;
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};

use super::shared::CssImportSymbols;
use crate::OxcTransformResult;

struct RuntimeTransformer<'a> {
  has_css: bool,
  has_global_css: bool,
  exports: Vec<CsslitClassExport>,
  css_import_symbols: CssImportSymbols<'a>,
  source_rope: Rope,
  source_text: &'a str,
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
        self.has_css = true;
        self.exports.push(CsslitClassExport {
          local_name,
          row: line,
          column,
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
) -> Option<OxcTransformResult> {
  let allocator = &Allocator::default();
  let ast = AstBuilder::new(allocator);

  let ret = Parser::new(allocator, &source_text, options.source_type)
    .with_options(ParseOptions {
      preserve_parens: false,
      ..ParseOptions::default()
    })
    .parse();

  let mut program = ret.program;

  let semantic = SemanticBuilder::new().build(&program).semantic;
  let css_import_symbols = CssImportSymbols::collect(allocator, &program);

  if !css_import_symbols.any() {
    return None;
  }

  let mut transformer = RuntimeTransformer {
    has_css: false,
    has_global_css: false,
    exports: Vec::new(),
    css_import_symbols,
    source_rope: Rope::from_str(&source_text),
    source_text: &source_text,
  };

  let scoping = semantic.into_scoping();
  traverse_mut(&mut transformer, allocator, &mut program, scoping, ());

  if !transformer.has_css && !transformer.has_global_css {
    return None;
  }

  let import_path = &options.import_path;

  if transformer.has_css {
    program.body.insert(
      0,
      quote_stmt!(
        ast,
        import __css_module_import from @"{import_path}.csslit.json";
      ),
    );
  }

  if transformer.has_css || transformer.has_global_css {
    program
      .body
      .insert(0, quote_stmt!(ast, import @"{import_path}.csslit.css";));
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

  Some(OxcTransformResult {
    code: result.code,
    map: result.map.map(Into::into),
    exports: transformer.exports,
  })
}
