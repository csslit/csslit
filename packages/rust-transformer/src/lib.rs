use napi_derive::napi;
use rolldown_sourcemap::SourceMap;

mod quote;
mod transform;

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
  pub map: Option<RawSourceMap>,
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
  pub map: Option<RawSourceMap>,
  pub warnings: Vec<String>,
}

#[napi(object)]
pub struct RawSourceMap {
  pub file: Option<String>,
  pub mappings: String,
  pub names: Vec<String>,
  pub source_root: Option<String>,
  pub sources: Vec<String>,
  #[napi(ts_type = "(string | null)[]")]
  pub sources_content: Option<Vec<Option<String>>>,
  pub version: u32,
  #[napi(js_name = "x_google_ignoreList")]
  pub x_google_ignore_list: Option<Vec<u32>>,
  pub debug_id: Option<String>,
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
    map: result.map.map(Into::into),
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
    map: result.map.map(Into::into),
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
      map: runtime.map.map(Into::into),
      exports: runtime.exports,
    },
    eval: TransformResult {
      code: eval.code,
      map: eval.map.map(Into::into),
      exports: eval.exports,
    },
  })
}

#[napi]
pub fn compile_csslit(options: CompileCsslitRequest) -> napi::Result<CompileCsslitResult> {
  transform::compile_csslit(options).map_err(|err| napi::Error::from_reason(err.to_string()))
}
