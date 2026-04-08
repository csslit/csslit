use oxc_allocator::{Allocator, Vec};
use oxc_ast::ast::{Expression, ImportDeclaration, ImportDeclarationSpecifier, Program, Statement};
use oxc_syntax::symbol::SymbolId;
use oxc_traverse::TraverseCtx;

pub(super) struct CssImportSymbols<'a> {
  named: Vec<'a, SymbolId>,
  namespaces: Vec<'a, SymbolId>,
}

impl CssImportSymbols<'_> {
  pub(super) fn collect<'a>(
    allocator: &'a Allocator,
    program: &Program<'a>,
  ) -> CssImportSymbols<'a> {
    let mut named = Vec::new_in(allocator);
    let mut namespaces = Vec::new_in(allocator);

    for specifier in program
      .body
      .iter()
      .filter_map(|value| match value {
        Statement::ImportDeclaration(import) => Some(import.as_ref()),
        _ => None,
      })
      .filter(|import| import.source.value == "csslit" && import.import_kind.is_value())
      .filter_map(|import| import.specifiers.as_ref())
      .flatten()
    {
      match specifier {
        ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
          if specifier.import_kind.is_value() && specifier.imported.name() == "css" {
            named.push(specifier.local.symbol_id());
          }
        }
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
          namespaces.push(specifier.local.symbol_id());
        }
        _ => {}
      }
    }

    CssImportSymbols { named, namespaces }
  }

  pub(super) fn is_css(&self, tag: &Expression<'_>, ctx: &TraverseCtx<'_, ()>) -> bool {
    match tag {
      Expression::Identifier(ident) => ctx
        .scoping()
        .get_reference(ident.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| self.named.contains(&symbol_id)),
      Expression::StaticMemberExpression(member) if member.property.name == "css" => member
        .object
        .get_identifier_reference()
        .and_then(|ident| {
          ctx
            .scoping()
            .get_reference(ident.reference_id())
            .symbol_id()
        })
        .is_some_and(|symbol_id| self.namespaces.contains(&symbol_id)),
      _ => false,
    }
  }
}
