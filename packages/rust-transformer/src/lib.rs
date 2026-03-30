use napi_derive::napi;
use rolldown_sourcemap::SourceMap;

#[doc(hidden)]
pub mod quote;
mod transform;

#[napi(object)]
pub struct RuntimeTransformRequest {
  pub filename: String,
  pub sourcemap: bool,
}

pub(crate) struct RuntimeTransformOptions {
  pub(crate) filename: String,
  pub(crate) sourcemap: bool,
}

#[napi(object)]
pub struct CompileTimeTransformRequest {
  pub filename: String,
  pub input_map: Option<RawSourceMap>,
  pub sourcemap: bool,
}

pub(crate) struct CompileTimeTransformOptions {
  pub(crate) filename: String,
  pub(crate) sourcemap: bool,
  pub(crate) input_map: Option<SourceMap>,
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

#[napi]
pub fn transform_runtime(
  source_text: String,
  options: RuntimeTransformRequest,
) -> napi::Result<TransformResult> {
  Ok(transform::transform_runtime(
    source_text,
    RuntimeTransformOptions {
      filename: options.filename,
      sourcemap: options.sourcemap,
    },
  ))
}

#[napi]
pub fn transform_compile_time(
  source_text: String,
  options: CompileTimeTransformRequest,
) -> napi::Result<TransformResult> {
  Ok(transform::transform_compile_time(
    source_text,
    CompileTimeTransformOptions {
      filename: options.filename,
      sourcemap: options.sourcemap,
      input_map: if options.sourcemap {
        options
          .input_map
          .map(SourceMap::try_from)
          .transpose()
          .map_err(|err| napi::Error::from_reason(err.to_string()))?
      } else {
        None
      },
    },
  ))
}
