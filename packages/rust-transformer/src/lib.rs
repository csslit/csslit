use napi_derive::napi;
use oxc_allocator::{Allocator, Box as AstBox};
use oxc_ast::ast::*;
use oxc_ast::AstBuilder;
use oxc_ast_visit::{walk, Visit};
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

struct CssVisitor {
    pub spans: Vec<(u32, u32)>,
    pub import_spans: Vec<(u32, u32)>,
}

impl<'a> Visit<'a> for CssVisitor {
    fn visit_import_declaration(&mut self, decl: &ImportDeclaration<'a>) {
        self.import_spans.push((decl.span.start, decl.span.end));
    }

    fn visit_export_named_declaration(&mut self, decl: &ExportNamedDeclaration<'a>) {
        if decl.source.is_some() {
            self.import_spans.push((decl.span.start, decl.span.end));
        }
        walk::walk_export_named_declaration(self, decl);
    }

    fn visit_export_all_declaration(&mut self, decl: &ExportAllDeclaration<'a>) {
        self.import_spans.push((decl.span.start, decl.span.end));
        walk::walk_export_all_declaration(self, decl);
    }

    fn visit_tagged_template_expression(&mut self, expr: &TaggedTemplateExpression<'a>) {
        if let Expression::Identifier(ident) = &expr.tag {
            if ident.name == "css" {
                self.spans.push((expr.span.start, expr.span.end));
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
                    let property = ctx.ast.identifier_name(SPAN, ctx.ast.atom("hashed_class"));
                    *expr = Expression::from(
                        ctx.ast
                            .member_expression_static(SPAN, object, property, false),
                    );
                }
            }
        }
    }
}

#[napi]
pub fn transform(source_text: String, options: TransformOptions) -> napi::Result<TransformResult> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(&options.filename)
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

    // compileTime mode still uses the visitor approach
    let ret = Parser::new(&allocator, &source_text, source_type).parse();
    let mut visitor = CssVisitor {
        spans: vec![],
        import_spans: vec![],
    };
    visitor.visit_program(&ret.program);

    let mut index = 1;
    let mut new_output = String::new();

    // Add imports
    for (start, end) in &visitor.import_spans {
        new_output.push_str(&source_text[*start as usize..*end as usize]);
        new_output.push('\n');
    }

    let mut exports = String::new();
    let mut sorted_spans = visitor.spans.clone();
    sorted_spans.sort_by(|a, b| a.0.cmp(&b.0));

    for (start, end) in &sorted_spans {
        let start_usize = *start as usize;
        let end_usize = *end as usize;
        // The expression includes css followed by template literal so we slice after css
        let slice = &source_text[start_usize + 3..end_usize];
        exports.push_str(&format!(
            "export const __ext_css_{} = () => {};\n",
            index, slice
        ));
        index += 1;
    }

    new_output.push_str("\n// --- COMPILE TIME EXPORTS ---\n");
    new_output.push_str(&exports);

    Ok(TransformResult {
        code: new_output,
        map: None,
    })
}
