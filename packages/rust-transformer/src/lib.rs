#![deny(clippy::all)]

use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ExportAllDeclaration, ExportNamedDeclaration, Expression, ImportDeclaration,
    TaggedTemplateExpression,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;

#[napi(object)]
pub struct TransformOptions {
    pub mode: String,
    pub filename: String,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
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

#[napi]
pub fn transform(source_text: String, options: TransformOptions) -> napi::Result<TransformResult> {
    let allocator = Allocator::default();
    let source_type = SourceType::default().with_typescript(true).with_jsx(true);

    let ret = Parser::new(&allocator, &source_text, source_type).parse();

    let mut visitor = CssVisitor {
        spans: vec![],
        import_spans: vec![],
    };
    visitor.visit_program(&ret.program);

    let mut output = source_text.clone();
    visitor.spans.sort_by(|a, b| b.0.cmp(&a.0));

    let mut index = 1;
    let mut imports = String::new();

    let safe_filename = options.filename.replace("\\", "/");

    if options.mode == "runtime" {
        for (start, end) in &visitor.spans {
            let start_usize = *start as usize;
            let end_usize = *end as usize;
            let replacement = format!("__css_module_import_{}.hashed_class", index);
            output.replace_range(start_usize..end_usize, &replacement);
            imports.push_str(&format!(
                "import __css_module_import_{} from 'virtual:css-compile/{}?id={}.module.css';\n",
                index, safe_filename, index
            ));
            index += 1;
        }
        output.insert_str(0, &imports);
    } else if options.mode == "compileTime" {
        let mut new_output = String::new();

        // Add imports
        for (start, end) in &visitor.import_spans {
            new_output.push_str(&source_text[*start as usize..*end as usize]);
            new_output.push('\n');
        }

        let mut exports = String::new();
        // Since we are building a new string, we don't need to sort spans backwards here,
        // but it doesn't hurt. Actually, we should iterate in original order if possible.
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
        output = new_output;
    }

    Ok(TransformResult { code: output })
}
