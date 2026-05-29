use oxc_allocator::{Allocator, Vec};
use oxc_ast::ast::{Expression, ImportDeclarationSpecifier, Program, Statement};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;
use oxc_traverse::TraverseCtx;

pub(super) struct CssImportSymbols<'alloc> {
  comptime_named: Vec<'alloc, SymbolId>,
  named: Vec<'alloc, SymbolId>,
  namespaces: Vec<'alloc, SymbolId>,
}

impl<'alloc> CssImportSymbols<'alloc> {
  pub(super) fn collect<'ast>(
    allocator: &'ast Allocator,
    program: &Program<'ast>,
  ) -> CssImportSymbols<'ast> {
    let mut comptime_named = Vec::new_in(allocator);
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
          if !specifier.import_kind.is_value() {
            continue;
          }

          let imported = specifier.imported.name();
          if imported == "css" {
            named.push(specifier.local.symbol_id());
          } else if imported == "comptime" {
            comptime_named.push(specifier.local.symbol_id());
          }
        }
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
          namespaces.push(specifier.local.symbol_id());
        }
        _ => {}
      }
    }

    CssImportSymbols {
      comptime_named,
      named,
      namespaces,
    }
  }

  pub(super) fn is_css(&self, tag: &Expression, ctx: &TraverseCtx<()>) -> bool {
    self.is_css_with_scoping(tag, ctx.scoping())
  }

  pub(super) fn is_css_with_scoping(&self, tag: &Expression, scoping: &Scoping) -> bool {
    match tag {
      Expression::Identifier(ident) => scoping
        .get_reference(ident.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| self.named.contains(&symbol_id)),
      Expression::StaticMemberExpression(member) if member.property.name == "css" => member
        .object
        .get_identifier_reference()
        .and_then(|ident| scoping.get_reference(ident.reference_id()).symbol_id())
        .is_some_and(|symbol_id| self.namespaces.contains(&symbol_id)),
      _ => false,
    }
  }

  pub(super) fn is_comptime_with_scoping(&self, callee: &Expression, scoping: &Scoping) -> bool {
    match callee {
      Expression::Identifier(ident) => scoping
        .get_reference(ident.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| self.comptime_named.contains(&symbol_id)),
      Expression::StaticMemberExpression(member) if member.property.name == "comptime" => member
        .object
        .get_identifier_reference()
        .and_then(|ident| scoping.get_reference(ident.reference_id()).symbol_id())
        .is_some_and(|symbol_id| self.namespaces.contains(&symbol_id)),
      _ => false,
    }
  }
}
