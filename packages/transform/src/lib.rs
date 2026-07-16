use annotate_snippets::renderer::DecorStyle;
use annotate_snippets::{AnnotationKind, Group, Level, Renderer, Snippet};
use napi_derive::napi;
use oxc_data_structures::rope::{Rope, get_offset_from_line_and_column};
use oxc_sourcemap::napi::SourceMap;

mod bit_set;
mod quote;
mod transform;

#[napi(object)]
pub struct DiagnosticLocation {
  pub row: u32,
  pub col: u32,
}

#[napi(object)]
pub struct DiagnosticSpan {
  pub start: DiagnosticLocation,
  pub end: DiagnosticLocation,
}

#[napi(object)]
pub struct DiagnosticAnnotation {
  pub span: DiagnosticSpan,
  pub label: String,
  pub primary: bool,
}

#[napi(object)]
pub struct DiagnosticSource {
  pub path: String,
  pub source: String,
  pub annotations: Vec<DiagnosticAnnotation>,
}

#[napi(object)]
pub struct FormatDiagnosticRequest {
  pub name: String,
  pub title: String,
  pub sources: Vec<DiagnosticSource>,
  pub notes: Vec<String>,
  pub helps: Vec<String>,
}

#[napi]
pub fn format_diagnostic(request: FormatDiagnosticRequest) -> String {
  let mut group = Group::with_title(
    Level::ERROR
      .with_name(request.name)
      .primary_title(request.title),
  );

  for source in &request.sources {
    let rope = Rope::from_str(&source.source);
    let annotations = source.annotations.iter().map(|annotation| {
      let start = get_offset_from_line_and_column(
        &rope,
        annotation.span.start.row,
        annotation.span.start.col,
      ) as usize;
      let end =
        get_offset_from_line_and_column(&rope, annotation.span.end.row, annotation.span.end.col)
          as usize;
      let kind = if annotation.primary {
        AnnotationKind::Primary
      } else {
        AnnotationKind::Context
      };

      kind.span(start..end).label(&annotation.label)
    });

    group = group.element(
      Snippet::source(&source.source)
        .path(&source.path)
        .annotations(annotations),
    );
  }

  for note in request.notes {
    group = group.element(Level::NOTE.message(note));
  }
  for help in request.helps {
    group = group.element(Level::HELP.message(help));
  }

  Renderer::plain()
    .decor_style(DecorStyle::Ascii)
    .render(&[group])
    .to_string()
}

#[napi(object)]
pub struct RuntimeTransformRequest {
  pub module_import: String,
  pub filename: String,
  pub sourcemap: bool,
}

struct RuntimeTransformOptions {
  module_import: String,
  filename: String,
  sourcemap: bool,
}

#[napi(object)]
pub struct CompileTimeTransformRequest {
  pub filename: String,
  pub css_filename: String,
  pub sourcemap: bool,
  pub css_sourcemap: Option<bool>,
}

#[napi(object)]
pub struct ClientTransformRequest {
  pub module_import: String,
  pub filename: String,
  pub css_filename: String,
  pub sourcemap: bool,
  pub css_sourcemap: Option<bool>,
}

struct CompileTimeTransformOptions {
  filename: String,
  sourcemap: bool,
  css_sourcemap: bool,
}

struct OxcTransformResult {
  code: String,
  map: Option<SourceMap>,
  exports: Vec<CsslitClassExport>,
}

#[napi(object)]
pub struct TransformResult {
  pub code: String,
  pub map: Option<SourceMap>,
  pub exports: Vec<CsslitClassExport>,
}

#[napi(object)]
pub struct ClientTransformResult {
  pub runtime: TransformResult,
  pub eval: TransformResult,
}

#[napi(object)]
#[derive(Clone)]
pub struct CsslitClassExport {
  pub local_name: String,
  pub scoped_name: String,
}

#[napi(object_from_js, discriminant = "kind", discriminant_case = "lowercase")]
pub enum CsslitEvalBlock {
  Scoped {
    scoped_name: String,
    code: String,
    mapping_runs: Option<Vec<u32>>,
  },
  Global {
    code: String,
    mapping_runs: Option<Vec<u32>>,
  },
}

#[napi(object)]
pub struct CompileCsslitRequest {
  pub filename: String,
  pub blocks: Vec<CsslitEvalBlock>,
  pub sourcemap: bool,
}

#[napi(object)]
pub struct CompileCsslitResult {
  pub code: String,
  pub map: Option<SourceMap>,
}

#[napi]
pub fn transform_runtime(
  source_text: String,
  options: RuntimeTransformRequest,
) -> napi::Result<TransformResult> {
  let result = transform::transform_runtime(
    source_text,
    RuntimeTransformOptions {
      module_import: options.module_import,
      filename: options.filename,
      sourcemap: options.sourcemap,
    },
  );

  Ok(TransformResult {
    code: result.code,
    map: result.map,
    exports: result.exports,
  })
}

#[napi]
pub fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformRequest,
) -> napi::Result<TransformResult> {
  let css_sourcemap = options.css_sourcemap.unwrap_or(options.sourcemap);
  let result = transform::transform_compile_time(
    source_text,
    CompileTimeTransformOptions {
      filename: options.filename,
      sourcemap: options.sourcemap,
      css_sourcemap,
    },
  );

  Ok(TransformResult {
    code: result.code,
    map: result.map,
    exports: result.exports,
  })
}

#[napi]
pub fn transform_client(
  source_text: String,
  options: ClientTransformRequest,
) -> napi::Result<ClientTransformResult> {
  let css_sourcemap = options.css_sourcemap.unwrap_or(options.sourcemap);
  let runtime = transform::transform_runtime(
    source_text.clone(),
    RuntimeTransformOptions {
      module_import: options.module_import,
      filename: options.filename.clone(),
      sourcemap: options.sourcemap,
    },
  );
  let eval = transform::transform_compile_time(
    source_text,
    CompileTimeTransformOptions {
      filename: options.filename,
      sourcemap: options.sourcemap,
      css_sourcemap,
    },
  );

  Ok(ClientTransformResult {
    runtime: TransformResult {
      code: runtime.code,
      map: runtime.map,
      exports: runtime.exports,
    },
    eval: TransformResult {
      code: eval.code,
      map: eval.map,
      exports: eval.exports,
    },
  })
}

#[napi]
pub fn compile_csslit(options: CompileCsslitRequest) -> napi::Result<CompileCsslitResult> {
  transform::compile_csslit(options).map_err(|err| napi::Error::from_reason(err.to_string()))
}
