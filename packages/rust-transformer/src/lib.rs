use napi_derive::napi;
use oxc_allocator::{Allocator, Box as AstBox, CloneIn, FromIn};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{Atom, GetSpan, SourceType, SPAN};
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};
use serde::Serialize;

#[napi(object)]
pub struct TransformOptions {
    pub mode: String,
    pub filename: String,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
    pub meta: Option<String>,
}

#[derive(Serialize)]
struct OffsetSpan {
    start: u32,
    end: u32,
}

#[derive(Serialize)]
struct CssBlockMetadata {
    index: u32,
    quasis: Vec<OffsetSpan>,
    expressions: Vec<OffsetSpan>,
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
        let map = result.map.map(|sm| sm.to_json_string());

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
    let metadata_json =
        serde_json::to_string(&visitor.blocks.iter().map(|block| &block.metadata).collect::<Vec<_>>())
            .unwrap();

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
        map: result.map.map(|sm| sm.to_json_string()),
        meta: Some(metadata_json),
    })
}
