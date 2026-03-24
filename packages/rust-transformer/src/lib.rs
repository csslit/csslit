use napi_derive::napi;
use oxc_allocator::{Allocator, Box as AstBox, CloneIn};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, SPAN};
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};

#[napi(object)]
pub struct TransformOptions {
    pub mode: String,
    pub filename: String,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}

struct CompileTimeVisitor<'a> {
    pub allocator: &'a Allocator,
    pub templates: Vec<TemplateLiteral<'a>>,
    pub import_spans: Vec<(u32, u32)>,
}

impl<'a> Traverse<'a, ()> for CompileTimeVisitor<'a> {
    fn enter_expression(&mut self, expr: &mut Expression<'a>, _ctx: &mut TraverseCtx<'a, ()>) {
        if let Expression::TaggedTemplateExpression(tagged) = expr {
            if let Expression::Identifier(ident) = &tagged.tag {
                if ident.name == "css" {
                    self.templates.push(tagged.quasi.clone_in(self.allocator));
                    eprintln!("[Rust] Tagged template 'css' found and pushed. Total: {}", self.templates.len());
                } else {
                    eprintln!("[Rust] Tagged template found with other tag: {}", ident.name);
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
                        "virtual:css-compile/{}?id={}.module.css",
                        self.filename.replace("\\", "/"),
                        index
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
    let clean_filename = options.filename.split('?').next().unwrap_or(&options.filename);
    let source_type = SourceType::from_path(clean_filename)
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
            filename: options.filename.clone(),
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
            source_map_path: Some(options.filename.clone().into()),
            ..CodegenOptions::default()
        };
        let result = Codegen::new().with_options(codegen_options).build(&program);
        let map = result.map.map(|sm| sm.to_json_string());

        return Ok(TransformResult {
            code: result.code,
            map,
        });
    }

    // compileTime mode: Extract CSS blocks and generate a JS module with exports + source map
    let mut ret = Parser::new(&allocator, &source_text, source_type).parse();
    
    let mut visitor = CompileTimeVisitor {
        allocator: &allocator,
        templates: vec![],
        import_spans: vec![],
    };
    let semantic_builder = SemanticBuilder::new();
    let semantic = semantic_builder.build(&ret.program).semantic;
    let scoping = semantic.into_scoping();

    let state = ();
    traverse_mut(&mut visitor, &allocator, &mut ret.program, scoping, state);

    let ast = AstBuilder::new(&allocator);
    let mut body = ast.vec();

    // 1. Re-parse or re-extract ImportDeclarations from the original program to preserve them
    for stmt in &ret.program.body {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                body.push(Statement::ImportDeclaration(
                    ast.alloc(CloneIn::clone_in(&**decl, &allocator)),
                ));
            }
            Statement::ExportNamedDeclaration(decl) if decl.source.is_some() => {
                body.push(Statement::ExportNamedDeclaration(
                    ast.alloc(CloneIn::clone_in(&**decl, &allocator)),
                ));
            }
            Statement::ExportAllDeclaration(decl) => {
                body.push(Statement::ExportAllDeclaration(
                    ast.alloc(CloneIn::clone_in(&**decl, &allocator)),
                ));
            }
            _ => {}
        }
    }

    // 2. Add the CSS exports
    let mut index = 1;
    let mut sorted_templates = visitor.templates;
    sorted_templates.sort_by(|a, b| a.span.start.cmp(&b.span.start));

    let templates_count = sorted_templates.len();
    for template in &sorted_templates {
        let export_name = format!("__ext_css_{}", index);
        index += 1;

        // Build: export const __ext_css_N = () => ({ css: `...`, map: "..." });
        
        // Internal map for the CSS block itself
        let sub_codegen_options = CodegenOptions {
            source_map_path: Some(options.filename.clone().into()),
            ..CodegenOptions::default()
        };
        let mut sub_body = ast.vec();
        sub_body.push(Statement::ExpressionStatement(ast.alloc(ast.expression_statement(
            SPAN,
            Expression::TemplateLiteral(ast.alloc(CloneIn::clone_in(template, &allocator))),
        ))));
        let mut sub_program = Parser::new(&allocator, &source_text, source_type).parse().program;
        sub_program.body = sub_body;
        let sub_result = Codegen::new()
            .with_options(sub_codegen_options)
            .with_source_text(&source_text)
            .build(&sub_program);
        let sub_map = sub_result.map.map(|sm| sm.to_json_string()).unwrap_or_else(|| "null".to_string());

        // Return object: { css: `...`, map: "..." }
        let obj = ast.expression_object(
            SPAN,
            {
                let mut props = ast.vec();
                props.push(ObjectPropertyKind::ObjectProperty(ast.alloc(ast.object_property(
                    SPAN,
                    PropertyKind::Init,
                    PropertyKey::StaticIdentifier(ast.alloc(ast.identifier_name(SPAN, ast.atom("css")))),
                    Expression::TemplateLiteral(ast.alloc(CloneIn::clone_in(template, &allocator))),
                    false, // method
                    false, // shorthand
                    false, // computed
                ))));
                props.push(ObjectPropertyKind::ObjectProperty(ast.alloc(ast.object_property(
                    SPAN,
                    PropertyKind::Init,
                    PropertyKey::StaticIdentifier(ast.alloc(ast.identifier_name(SPAN, ast.atom("map")))),
                    Expression::StringLiteral(ast.alloc(ast.string_literal(SPAN, ast.atom(&sub_map), None))),
                    false, // method
                    false, // shorthand
                    false, // computed
                ))));
                props
            },
        );

        // Arrow function: () => obj
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
        arrow.body.statements.push(Statement::ExpressionStatement(ast.alloc(ast.expression_statement(SPAN, obj))));

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

    let mut final_program = Parser::new(&allocator, &source_text, source_type).parse().program;
    final_program.body = body;

    let codegen_options = CodegenOptions {
        source_map_path: Some(options.filename.clone().into()),
        ..CodegenOptions::default()
    };
    let result = Codegen::new()
        .with_options(codegen_options)
        .with_source_text(&source_text)
        .build(&final_program);
    
    Ok(TransformResult {
        code: result.code,
        map: result.map.map(|sm| sm.to_json_string()),
    })
}
