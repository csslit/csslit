use napi_derive::napi;
use merge_source_map::merge;
use oxc_allocator::{Allocator, Box as AstBox, CloneIn, FromIn};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{Atom, GetSpan, SourceType, SPAN};
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};
use serde::Serialize;
use std::path::{Path, PathBuf};
use sourcemap::SourceMap;

#[napi(object)]
pub struct TransformOptions {
    pub mode: String,
    pub filename: String,
    pub input_map: Option<String>,
    pub root: Option<String>,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
    pub meta: Option<String>,
}

#[derive(Clone, Serialize)]
struct OffsetSpan {
    start: u32,
    end: u32,
}

#[derive(Clone, Serialize)]
struct CssBlockMetadata {
    index: u32,
    quasis: Vec<OffsetSpan>,
    expressions: Vec<OffsetSpan>,
}

#[derive(Serialize)]
struct SourceLocation {
    source: String,
    line: u32,
    column: u32,
    content: Option<String>,
}

#[derive(Serialize)]
struct RemappedCssBlock {
    index: u32,
    quasis: Vec<SourceLocation>,
    expressions: Vec<SourceLocation>,
}

struct CssTemplateBlock<'a> {
    template: TemplateLiteral<'a>,
    metadata: CssBlockMetadata,
}

fn normalized_source_filename(filename: &str) -> String {
    filename
        .split('?')
        .next()
        .unwrap_or(filename)
        .replace('\\', "/")
}

fn normalize_path_string(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_path_buf(path: &Path) -> String {
    normalize_path_string(path.to_string_lossy().as_ref())
}

fn is_within_root(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

fn to_browser_source_path(source: &str, root: &str) -> String {
    let normalized_source = normalize_path_string(source);
    if !Path::new(&normalized_source).is_absolute() {
        return normalized_source;
    }
    if !is_within_root(&normalized_source, root) {
        return normalized_source;
    }

    match Path::new(&normalized_source).strip_prefix(root) {
        Ok(relative) => format!("/{}", normalize_path_buf(relative)),
        Err(_) => normalized_source,
    }
}

fn resolve_original_source(source: &str, clean_id: &str, root: &str) -> String {
    let clean_source = source.split('?').next().unwrap_or(source);

    if clean_source.starts_with('/') {
        return clean_source.to_string();
    }

    let normalized_source = normalize_path_string(clean_source);
    if Path::new(&normalized_source).is_absolute() {
        return to_browser_source_path(&normalized_source, root);
    }

    let resolved = Path::new(clean_id)
        .parent()
        .map(|parent| parent.join(clean_source))
        .unwrap_or_else(|| PathBuf::from(clean_source));

    to_browser_source_path(&normalize_path_buf(&resolved), root)
}

fn create_line_starts(code: &str) -> Vec<u32> {
    let mut line_starts = vec![0];
    for (index, byte) in code.bytes().enumerate() {
        if byte == b'\n' {
            line_starts.push(index as u32 + 1);
        }
    }
    line_starts
}

fn offset_to_position(line_starts: &[u32], offset: u32) -> (u32, u32) {
    let line_index = match line_starts.binary_search(&offset) {
        Ok(index) => index,
        Err(index) => index.saturating_sub(1),
    };
    let line_start = line_starts.get(line_index).copied().unwrap_or(0);
    (line_index as u32, offset.saturating_sub(line_start))
}

fn trace_location(
    span: &OffsetSpan,
    line_starts: &[u32],
    fallback_source: &str,
    fallback_content: &str,
    input_map: Option<&SourceMap>,
    root: &str,
) -> SourceLocation {
    let (generated_line, generated_column) = offset_to_position(line_starts, span.start);

    if let Some(input_map) = input_map {
        if let Some(token) = input_map.lookup_token(generated_line, generated_column) {
            if let Some(source) = token.get_source() {
                let content = token
                    .get_source_view()
                    .map(|view| view.source().to_string())
                    .or_else(|| {
                        let src_id = token.get_src_id();
                        if src_id == !0 {
                            None
                        } else {
                            input_map.get_source_contents(src_id).map(ToString::to_string)
                        }
                    });

                return SourceLocation {
                    source: resolve_original_source(source, fallback_source, root),
                    line: token.get_src_line() + 1,
                    column: token.get_src_col(),
                    content,
                };
            }
        }
    }

    SourceLocation {
        source: to_browser_source_path(fallback_source, root),
        line: generated_line + 1,
        column: generated_column,
        content: Some(fallback_content.to_string()),
    }
}

fn remap_css_metadata(
    metadata: &[CssBlockMetadata],
    source_text: &str,
    clean_id: &str,
    root: &str,
    input_map: Option<&SourceMap>,
) -> Vec<RemappedCssBlock> {
    let line_starts = create_line_starts(source_text);

    metadata
        .iter()
        .map(|block| RemappedCssBlock {
            index: block.index,
            quasis: block
                .quasis
                .iter()
                .map(|span| trace_location(span, &line_starts, clean_id, source_text, input_map, root))
                .collect(),
            expressions: block
                .expressions
                .iter()
                .map(|span| trace_location(span, &line_starts, clean_id, source_text, input_map, root))
                .collect(),
        })
        .collect()
}

fn sourcemap_to_json(map: &SourceMap) -> String {
    let mut output = Vec::new();
    map.to_writer(&mut output).unwrap();
    String::from_utf8(output).unwrap()
}

fn parse_output_sourcemap<T: ToString>(map: T) -> SourceMap {
    SourceMap::from_slice(map.to_string().as_bytes()).unwrap()
}

fn collapse_sourcemap(
    output_map: Option<SourceMap>,
    input_map: Option<&SourceMap>,
) -> Option<String> {
    match (output_map, input_map) {
        (Some(output_map), Some(input_map)) if input_map.get_token_count() > 0 => {
            Some(sourcemap_to_json(&merge(vec![input_map.clone(), output_map], Default::default())))
        }
        (Some(output_map), _) => Some(sourcemap_to_json(&output_map)),
        (None, _) => None,
    }
}

fn is_relative_script_import(specifier: &str) -> bool {
    if !specifier.starts_with('.') || specifier.contains("?css-compile-eval") {
        return false;
    }

    matches!(
        specifier.rsplit_once('.').map(|(_, ext)| ext),
        Some("js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts")
    )
}

fn append_eval_query(specifier: &str) -> String {
    if is_relative_script_import(specifier) {
        format!("{specifier}?css-compile-eval")
    } else {
        specifier.to_string()
    }
}

struct CompileTimeVisitor<'a> {
    pub allocator: &'a Allocator,
    pub blocks: Vec<CssTemplateBlock<'a>>,
}

impl<'a> Traverse<'a, ()> for CompileTimeVisitor<'a> {
    fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
        if let Expression::TaggedTemplateExpression(tagged) = expr {
            if let Expression::Identifier(ident) = &tagged.tag {
                if ident.name == "css" {
                    let index = self.blocks.len() as u32 + 1;
                    let quasis = tagged
                        .quasi
                        .quasis
                        .iter()
                        .map(|quasi| OffsetSpan {
                            start: quasi.span.start,
                            end: quasi.span.end,
                        })
                        .collect();
                    let expressions = tagged
                        .quasi
                        .expressions
                        .iter()
                        .map(|expression| OffsetSpan {
                            start: expression.span().start,
                            end: expression.span().end,
                        })
                        .collect();

                    self.blocks.push(CssTemplateBlock {
                        template: tagged.quasi.clone_in(self.allocator),
                        metadata: CssBlockMetadata {
                            index,
                            quasis,
                            expressions,
                        },
                    });
                    *expr = Expression::StringLiteral(
                        ctx.ast.alloc(ctx.ast.string_literal(SPAN, ctx.ast.atom(""), None)),
                    );
                }
            }
        }
    }
}

struct RuntimeTransformer {
    filename: String,
    imports_to_add: Vec<(String, String)>,
    index: u32,
}

impl<'a> Traverse<'a, ()> for RuntimeTransformer {
    fn enter_expression(&mut self, expr: &mut Expression<'a>, ctx: &mut TraverseCtx<'a, ()>) {
        if let Expression::TaggedTemplateExpression(tagged) = expr {
            if let Expression::Identifier(ident) = &tagged.tag {
                if ident.name == "css" {
                    let index = self.index;
                    self.index += 1;
                    let import_name = format!("__css_module_import_{}", index);
                    let virtual_path = format!(
                        "virtual:css-compile/{}.module.css?source={}",
                        index, self.filename
                    );
                    self.imports_to_add
                        .push((import_name.clone(), virtual_path));

                    let object = ctx
                        .ast
                        .expression_identifier(SPAN, ctx.ast.atom(&import_name));
                    let property = Expression::StringLiteral(ctx.ast.alloc(ctx.ast.string_literal(SPAN, ctx.ast.atom(&format!("css-{}", index)), None)));
                    *expr = Expression::from(
                        ctx.ast
                            .member_expression_computed(SPAN, object, property, false),
                    );
                }
            }
        }
    }
}

#[napi]
pub fn transform(source_text: String, options: TransformOptions) -> napi::Result<TransformResult> {
    let allocator = Allocator::default();
    let source_filename = normalized_source_filename(&options.filename);
    let root = options
        .root
        .as_deref()
        .map(normalized_source_filename)
        .unwrap_or_else(String::new);
    let input_map = options
        .input_map
        .as_deref()
        .and_then(|map| SourceMap::from_slice(map.as_bytes()).ok());
    let source_type = SourceType::from_path(&source_filename)
        .unwrap_or_default()
        .with_typescript(true)
        .with_jsx(true);

    if options.mode == "runtime" {
        let ret = Parser::new(&allocator, &source_text, source_type).parse();
        let mut program = ret.program;

        let semantic_builder = SemanticBuilder::new();
        let semantic = semantic_builder.build(&program).semantic;
        let scoping = semantic.into_scoping();

        let mut transformer = RuntimeTransformer {
            filename: source_filename.clone(),
            imports_to_add: vec![],
            index: 1,
        };

        let state = ();
        traverse_mut(&mut transformer, &allocator, &mut program, scoping, state);

        let ast = AstBuilder::new(&allocator);
        for (name, path) in transformer.imports_to_add.into_iter().rev() {
            let decl = ast.import_declaration(
                SPAN,
                Some({
                    let mut vec = ast.vec();
                    vec.push(ImportDeclarationSpecifier::ImportDefaultSpecifier(
                        ast.alloc(ast.import_default_specifier(
                            SPAN,
                            ast.binding_identifier(SPAN, ast.atom(&name)),
                        )),
                    ));
                    vec
                }),
                ast.string_literal(SPAN, ast.atom(&path), None),
                None::<ImportPhase>,
                None::<AstBox<WithClause>>,
                ImportOrExportKind::Value,
            );
            program.body.insert(
                0,
                Statement::from(ModuleDeclaration::ImportDeclaration(ast.alloc(decl))),
            );
        }

        let codegen_options = CodegenOptions {
            source_map_path: Some(source_filename.clone().into()),
            ..CodegenOptions::default()
        };
        let result = Codegen::new().with_options(codegen_options).build(&program);
        let map = collapse_sourcemap(
            result.map.map(|sm| parse_output_sourcemap(sm.to_json_string())),
            input_map.as_ref(),
        );

        return Ok(TransformResult {
            code: result.code,
            map,
            meta: None,
        });
    }

    // compileTime mode: Extract CSS blocks and generate a JS module with exports + source map
    let mut ret = Parser::new(&allocator, &source_text, source_type).parse();
    
    let mut visitor = CompileTimeVisitor {
        allocator: &allocator,
        blocks: vec![],
    };
    let semantic_builder = SemanticBuilder::new();
    let semantic = semantic_builder.build(&ret.program).semantic;
    let scoping = semantic.into_scoping();

    let state = ();
    traverse_mut(&mut visitor, &allocator, &mut ret.program, scoping, state);

    for stmt in &mut ret.program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                let updated = append_eval_query(decl.source.value.as_str());
                if updated != decl.source.value.as_str() {
                    decl.source.value = Atom::from_in(updated, &allocator);
                    decl.source.raw = None;
                }
            }
            Statement::ExportNamedDeclaration(decl) => {
                if let Some(source) = &mut decl.source {
                    let updated = append_eval_query(source.value.as_str());
                    if updated != source.value.as_str() {
                        source.value = Atom::from_in(updated, &allocator);
                        source.raw = None;
                    }
                }
            }
            Statement::ExportAllDeclaration(decl) => {
                let updated = append_eval_query(decl.source.value.as_str());
                if updated != decl.source.value.as_str() {
                    decl.source.value = Atom::from_in(updated, &allocator);
                    decl.source.raw = None;
                }
            }
            _ => {}
        }
    }

    let ast = AstBuilder::new(&allocator);
    let mut body = CloneIn::clone_in(&ret.program.body, &allocator);

    // Append the CSS exports without dropping the original module body.
    let remapped_metadata = remap_css_metadata(
        &visitor
            .blocks
            .iter()
            .map(|block| block.metadata.clone())
            .collect::<Vec<_>>(),
        &source_text,
        &source_filename,
        &root,
        input_map.as_ref(),
    );
    let metadata_json = serde_json::to_string(&remapped_metadata).unwrap();

    for block in &visitor.blocks {
        let export_name = format!("__ext_css_{}", block.metadata.index);
        let extractor_name = format!("__csslit_extract_{}", block.metadata.index);
        let extraction_expression = Expression::TaggedTemplateExpression(
            ast.alloc_tagged_template_expression(
                SPAN,
                ast.expression_identifier(SPAN, ast.atom(&extractor_name)),
                None::<TSTypeParameterInstantiation>,
                CloneIn::clone_in(&block.template, &allocator),
            ),
        );

        // Arrow function: () => __csslit_extract_N`...`
        // Signature: (span, expression, async, type_params, params, return_type, body)
        let mut arrow = ast.arrow_function_expression(
            SPAN,
            true, // expression
            false, // async
            None::<TSTypeParameterDeclaration>,
            ast.formal_parameters(SPAN, FormalParameterKind::ArrowFormalParameters, ast.vec(), None::<FormalParameterRest>),
            None::<TSTypeAnnotation>,
            ast.function_body(SPAN, ast.vec(), ast.vec()),
        );
        arrow.body.statements.clear();
        arrow.body
            .statements
            .push(Statement::ExpressionStatement(ast.alloc(ast.expression_statement(
                SPAN,
                extraction_expression,
            ))));

        // Variable declaration: const __ext_css_N = arrow
        let var_decl = ast.variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            {
                let mut decls = ast.vec();
                decls.push(ast.variable_declarator(
                    SPAN,
                    VariableDeclarationKind::Const,
                    BindingPattern::BindingIdentifier(ast.alloc(ast.binding_identifier(SPAN, ast.atom(&export_name)))),
                    None::<TSTypeAnnotation>,
                    Some(Expression::ArrowFunctionExpression(ast.alloc(arrow))),
                    false,
                ));
                decls
            },
            false,
        );
        
        body.push(Statement::ExportNamedDeclaration(ast.alloc(ast.export_named_declaration(
                SPAN, 
                Some(Declaration::VariableDeclaration(ast.alloc(var_decl))), 
                ast.vec(), 
                None, 
                ImportOrExportKind::Value,
                None::<WithClause>, // with_clause
            ))
        ));
    }

    ret.program.body = body;

    let codegen_options = CodegenOptions {
        source_map_path: Some(source_filename.into()),
        ..CodegenOptions::default()
    };
    let result = Codegen::new()
        .with_options(codegen_options)
        .with_source_text(&source_text)
        .build(&ret.program);
    
    Ok(TransformResult {
        code: result.code,
        map: collapse_sourcemap(
            result.map.map(|sm| parse_output_sourcemap(sm.to_json_string())),
            input_map.as_ref(),
        ),
        meta: Some(metadata_json),
    })
}
