use crate::{CompileTimeTransformOptions, OxcTransformResult, quote_expr, quote_stmt};
use oxc_allocator::{Allocator, CloneIn, Vec};
use oxc_ast::{
  AstBuilder, NONE,
  ast::{Expression, Statement, TemplateLiteral},
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_data_structures::rope::{Rope, get_line_column};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_sourcemap::SourceMapBuilder;
use oxc_span::{SPAN, SourceType};
use oxc_traverse::{Traverse, TraverseCtx, traverse_mut};
use rolldown_sourcemap::{SourceMap, collapse_sourcemaps};
use std::path::Path;

use super::shared::CssImportSymbols;

struct ResolvedLocation {
  line: u32,
  column: u32,
}

struct SourceLocationContext<'a> {
  builder: SourceMapBuilder,
  source_rope: Rope,
  source_text: &'a str,
  source_id: u32,
}

impl<'a> SourceLocationContext<'a> {
  fn new(source_text: &'a str, filename: &'a str, root: &str) -> Self {
    let mut builder = SourceMapBuilder::default();
    builder.set_file(&format!("{filename}.csslit.module.css"));
    let normalized_filename = normalize_source_id(filename, root);
    let source_id = builder.add_source_and_content(&normalized_filename, source_text);

    Self {
      builder,
      source_rope: Rope::from_str(source_text),
      source_text,
      source_id,
    }
  }

  fn resolve(&self, span: oxc_span::Span) -> ResolvedLocation {
    let (line, column) = get_line_column(&self.source_rope, span.start, self.source_text);

    ResolvedLocation { line, column }
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

fn normalize_source_id(source: &str, root: &str) -> String {
  let (path, query) = source
    .split_once('?')
    .map_or((source, None), |(path, query)| (path, Some(query)));
  let normalized_path = path.replace('\\', "/");

  let normalized = if Path::new(path).is_absolute() {
    match Path::new(path).strip_prefix(root) {
      Ok(relative) => format!("/{}", relative.to_string_lossy().replace('\\', "/")),
      Err(_) => normalized_path,
    }
  } else {
    normalized_path
  };

  match query {
    Some(query) => format!("{normalized}?{query}"),
    None => normalized,
  }
}

struct CompileTimeVisitor<'a> {
  blocks: Vec<'a, TemplateLiteral<'a>>,
  css_import_symbols: CssImportSymbols<'a>,
}

impl<'a> Traverse<'a, ()> for CompileTimeVisitor<'a> {
  fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
    if let Expression::TaggedTemplateExpression(tagged) = expr
      && self.css_import_symbols.is_css(&tagged.tag, ctx)
    {
      self.blocks.push(tagged.quasi.clone_in(ctx.ast.allocator));
      *expr = quote_expr!(ctx.ast, "");
    }
  }
}

pub(super) fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformOptions,
) -> OxcTransformResult {
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

  let location_context = options
    .sourcemap
    .then(|| SourceLocationContext::new(&source_text, &options.filename, &options.root));

  let ast = AstBuilder::new(allocator);

  let original_body = ret.program.body;
  let (blocks, baseline_map) =
    build_css_eval_blocks(ast, allocator, visitor.blocks, location_context);

  ret.program.body = ast.vec_with_capacity(
    2 + original_body
      .iter()
      .filter(|statement| matches!(statement, Statement::ImportDeclaration(_)))
      .count(),
  );

  ret.program.body.push(quote_stmt!(
    ast,
    import * as __csslit_eval_runtime from "virtual:csslit-eval-runtime";
  ));

  ret.program.body.extend(
    original_body
      .into_iter()
      .filter(|statement| matches!(statement, Statement::ImportDeclaration(_))),
  );

  let baseline_map = match [&baseline_map, &options.input_map] {
    [Some(baseline_map), Some(input_map)] => Some(collapse_sourcemaps(&[input_map, baseline_map])),
    _ => baseline_map,
  };

  let baseline_map = match baseline_map {
    Some(map) => {
      let json = map.to_json_string();
      quote_expr!(ast, JSON.parse(@{json}))
    }
    None => quote_expr!(ast, null),
  };

  ret.program.body.push(quote_stmt!(
    ast,
    export const __csslit_eval_result = (__csslit_eval_runtime.finalizeCsslitEvalResult({
      blocks: @{blocks},
      map: @{baseline_map},
    }));
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

  OxcTransformResult {
    code: result.code,
    map: result
      .map
      .map(|transform_map| match options.input_map.as_ref() {
        Some(input_map) => collapse_sourcemaps(&[input_map, &transform_map]),
        None => transform_map,
      }),
  }
}

fn build_css_eval_blocks<'a>(
  ast: AstBuilder<'a>,
  allocator: &'a Allocator,
  templates: Vec<'a, TemplateLiteral<'a>>,
  location_context: Option<SourceLocationContext<'a>>,
) -> (Vec<'a, Expression<'a>>, Option<SourceMap>) {
  let mut blocks = Vec::with_capacity_in(templates.len(), allocator);

  let Some(mut location_context) = location_context else {
    for template in templates {
      blocks.push(build_css_eval_block_expression(
        ast,
        template,
        Vec::new_in(allocator),
      ));
    }

    return (blocks, None);
  };

  let mut current_line = 0u32;

  for template in templates {
    let mut patch_lines = Vec::with_capacity_in(template.expressions.len(), allocator);

    let start_loc = location_context.resolve(template.quasis.first().unwrap().span);
    location_context.add_token(current_line, 0, start_loc);

    current_line += 1;

    for (index, quasi) in template.quasis.iter().enumerate() {
      let raw = quasi.value.raw;
      let cooked = quasi.value.cooked.unwrap_or(raw);
      let generated_line_count = cooked.lines().count() as u32;
      let source_line_count = raw.lines().count() as u32;

      if !cooked.is_empty() {
        let quasi_loc = location_context.resolve(quasi.span);
        for line_offset in 0..generated_line_count {
          location_context.add_token(
            current_line + line_offset,
            0,
            ResolvedLocation {
              line: quasi_loc.line + line_offset.min(source_line_count - 1),
              column: if line_offset == 0 {
                quasi_loc.column
              } else {
                0
              },
            },
          );
        }

        current_line += generated_line_count - 1;
      }

      if index < template.expressions.len() {
        patch_lines.push(current_line);
      }
    }

    current_line += 2;
    blocks.push(build_css_eval_block_expression(ast, template, patch_lines));
  }

  (blocks, Some(location_context.into_sourcemap()))
}

fn build_css_eval_block_expression<'a>(
  ast: AstBuilder<'a>,
  template: TemplateLiteral<'a>,
  patch_lines: Vec<'a, u32>,
) -> Expression<'a> {
  let patch_lines = ast.vec_from_iter(
    patch_lines
      .into_iter()
      .map(|line| quote_expr!(ast, @{line})),
  );

  ast.expression_tagged_template(
    SPAN,
    quote_expr!(ast, __csslit_eval_runtime.createCsslitCapture({ patch_lines: @{patch_lines} })),
    NONE,
    template,
  )
}
