use napi_derive::napi;
use crate::transform::{transform_compile_time, transform_runtime};

mod transform;


#[napi(string_enum = "snake_case")]
pub enum TransformMode {
    Runtime,
    CompileTime,
}

#[napi(object)]
pub struct TransformOptions {
    pub mode: TransformMode,
    pub filename: String,
    pub input_map: Option<RawSourceMap>,
    pub sourcemap: bool,
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
pub fn transform(source_text: String, options: TransformOptions) -> napi::Result<TransformResult> {
    Ok(match options.mode {
        TransformMode::Runtime => transform_runtime(
            source_text,
            options
        ),
        TransformMode::CompileTime => transform_compile_time(
            source_text,
            options
        ),
    })
}
