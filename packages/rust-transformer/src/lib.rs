use napi_derive::napi;
use rolldown_sourcemap::{JSONSourceMap, SourceMap};

#[doc(hidden)]
pub mod quote;
mod transform {
  mod compile_time;
  mod runtime;
  mod shared;

  pub(crate) fn transform_runtime(
    source_text: String,
    options: crate::RuntimeTransformOptions,
  ) -> crate::OxcTransformResult {
    runtime::transform_runtime(source_text, options)
  }

  pub(crate) fn transform_compile_time(
    source_text: String,
    options: crate::CompileTimeTransformOptions,
  ) -> crate::OxcTransformResult {
    compile_time::transform_compile_time(source_text, options)
  }
}

#[napi(object)]
pub struct RuntimeTransformRequest {
  pub filename: String,
  pub sourcemap: bool,
}

struct RuntimeTransformOptions {
  filename: String,
  sourcemap: bool,
}

#[napi(object)]
pub struct CompileTimeTransformRequest {
  pub filename: String,
  pub css_filename: String,
  pub input_map: Option<RawSourceMap>,
  pub sourcemap: bool,
  pub css_sourcemap: Option<bool>,
}

struct CompileTimeTransformOptions {
  filename: String,
  css_filename: String,
  sourcemap: bool,
  css_sourcemap: bool,
  input_map: Option<SourceMap>,
}

struct OxcTransformResult {
  code: String,
  map: Option<SourceMap>,
}

#[napi(object)]
pub struct TransformResult {
  pub code: String,
  pub map: Option<RawSourceMap>,
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

#[napi]
pub fn transform_runtime(
  source_text: String,
  options: RuntimeTransformRequest,
) -> napi::Result<TransformResult> {
  let result = transform::transform_runtime(
    source_text,
    RuntimeTransformOptions {
      filename: options.filename,
      sourcemap: options.sourcemap,
    },
  );

  Ok(TransformResult {
    code: result.code,
    map: result.map.map(Into::into),
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
      css_filename: options.css_filename,
      filename: options.filename,
      sourcemap: options.sourcemap,
      css_sourcemap,
      input_map: if options.sourcemap || css_sourcemap {
        options
          .input_map
          .map(SourceMap::try_from)
          .transpose()
          .map_err(|err| napi::Error::from_reason(err.to_string()))?
      } else {
        None
      },
    },
  );

  Ok(TransformResult {
    code: result.code,
    map: result.map.map(Into::into),
  })
}
