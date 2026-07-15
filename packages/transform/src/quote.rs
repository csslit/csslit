use oxc_allocator::{FromIn, GetAllocator, Vec};
use oxc_ast::{
  ast::{
    Argument, ArrayExpressionElement, AssignmentTarget, BindingIdentifier, BindingPattern,
    BindingRestElement, Declaration, Expression, FormalParameter, FormalParameterKind,
    FormalParameterRest, FormalParameters, FunctionBody, IdentifierName,
    ImportDeclarationSpecifier, ImportOrExportKind, ObjectPropertyKind, PropertyKey, Statement,
    StringLiteral, VariableDeclarationKind, VariableDeclarator,
  },
  builder::{AstBuild, GetAstBuilder, NONE},
};
use oxc_span::Span;
use oxc_str::{Ident, Str};
use oxc_syntax::{number::NumberBase, operator::AssignmentOperator};

#[doc(hidden)]
pub struct QuoteAstBuilder<'builder, 'alloc, B: AstBuild<'alloc>>(
  &'builder B,
  std::marker::PhantomData<&'alloc ()>,
);

impl<'builder, 'alloc, B: AstBuild<'alloc>> QuoteAstBuilder<'builder, 'alloc, B> {
  pub fn new(builder: &'builder B) -> Self {
    Self(builder, std::marker::PhantomData)
  }
}

impl<'builder, 'alloc, B: AstBuild<'alloc>> GetAstBuilder<'alloc>
  for QuoteAstBuilder<'builder, 'alloc, B>
{
  type Builder = B;

  fn builder(&self) -> &Self::Builder {
    self.0
  }
}

impl<'builder, 'alloc, B: AstBuild<'alloc>> GetAllocator<'alloc>
  for QuoteAstBuilder<'builder, 'alloc, B>
{
  fn allocator(&self) -> &'alloc oxc_allocator::Allocator {
    self.0.allocator()
  }
}

#[doc(hidden)]
pub trait QuoteLiteral<'a> {
  fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a>;
}

#[doc(hidden)]
pub fn quote_literal<'a, T>(ast: &impl GetAstBuilder<'a>, span: Span, value: T) -> Expression<'a>
where
  T: QuoteLiteral<'a>,
{
  value.into_quoted_expression(ast, span)
}

#[doc(hidden)]
pub trait QuoteInterpolation<'a> {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a>;
}

#[doc(hidden)]
pub fn quote_interpolation<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  value: T,
) -> Expression<'a>
where
  T: QuoteInterpolation<'a>,
{
  value.into_quoted_interpolation(ast, span)
}

#[doc(hidden)]
pub fn quote_array_expression<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  values: impl IntoIterator<Item = T>,
) -> Expression<'a>
where
  T: QuoteInterpolation<'a>,
{
  Expression::new_array_expression(
    span,
    Vec::from_iter_in(
      values
        .into_iter()
        .map(|value| ArrayExpressionElement::from(quote_interpolation(ast, span, value))),
      ast.builder(),
    ),
    ast,
  )
}

#[doc(hidden)]
pub trait QuoteStatements<'a> {
  fn into_quoted_statements(
    self,
    ast: &impl GetAstBuilder<'a>,
    span: Span,
  ) -> Vec<'a, Statement<'a>>;
}

#[doc(hidden)]
pub fn quote_statements<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  value: T,
) -> Vec<'a, Statement<'a>>
where
  T: QuoteStatements<'a>,
{
  value.into_quoted_statements(ast, span)
}

#[doc(hidden)]
pub trait QuoteBindingName<'a> {
  fn into_quoted_binding_name(self, ast: &impl GetAstBuilder<'a>) -> Ident<'a>;
}

#[doc(hidden)]
pub fn quote_binding_name<'a, T>(ast: &impl GetAstBuilder<'a>, value: T) -> Ident<'a>
where
  T: QuoteBindingName<'a>,
{
  value.into_quoted_binding_name(ast)
}

#[doc(hidden)]
pub trait QuoteModuleSource<'a> {
  fn into_quoted_module_source(self, ast: &impl GetAstBuilder<'a>, span: Span)
  -> StringLiteral<'a>;
}

#[doc(hidden)]
pub fn quote_module_source<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  value: T,
) -> StringLiteral<'a>
where
  T: QuoteModuleSource<'a>,
{
  value.into_quoted_module_source(ast, span)
}

impl<'a> QuoteLiteral<'a> for &'a str {
  fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_string_literal(span, self, None, ast)
  }
}

impl<'a> QuoteLiteral<'a> for String {
  fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_string_literal(
      span,
      Str::from_in(self, ast.builder().allocator()),
      None,
      ast,
    )
  }
}

impl<'a> QuoteLiteral<'a> for Str<'a> {
  fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_string_literal(span, self, None, ast)
  }
}

impl<'a> QuoteBindingName<'a> for &'a str {
  fn into_quoted_binding_name(self, _ast: &impl GetAstBuilder<'a>) -> Ident<'a> {
    Ident::from(self)
  }
}

impl<'a> QuoteBindingName<'a> for String {
  fn into_quoted_binding_name(self, ast: &impl GetAstBuilder<'a>) -> Ident<'a> {
    Ident::from_in(self, ast.builder().allocator())
  }
}

impl<'a> QuoteBindingName<'a> for Ident<'a> {
  fn into_quoted_binding_name(self, _ast: &impl GetAstBuilder<'a>) -> Ident<'a> {
    self
  }
}

impl<'a> QuoteModuleSource<'a> for &'a str {
  fn into_quoted_module_source(
    self,
    ast: &impl GetAstBuilder<'a>,
    span: Span,
  ) -> StringLiteral<'a> {
    StringLiteral::new(span, self, None, ast)
  }
}

impl<'a> QuoteModuleSource<'a> for String {
  fn into_quoted_module_source(
    self,
    ast: &impl GetAstBuilder<'a>,
    span: Span,
  ) -> StringLiteral<'a> {
    StringLiteral::new(
      span,
      Str::from_in(self, ast.builder().allocator()),
      None,
      ast,
    )
  }
}

impl<'a> QuoteModuleSource<'a> for Str<'a> {
  fn into_quoted_module_source(
    self,
    ast: &impl GetAstBuilder<'a>,
    span: Span,
  ) -> StringLiteral<'a> {
    StringLiteral::new(span, self, None, ast)
  }
}

impl<'a> QuoteLiteral<'a> for bool {
  fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_boolean_literal(span, self, ast)
  }
}

macro_rules! impl_quote_numeric_literal {
  ($($ty:ty),* $(,)?) => {
    $(
      impl<'a> QuoteLiteral<'a> for $ty {
        fn into_quoted_expression(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
          Expression::new_numeric_literal(span, self as f64, None, NumberBase::Decimal, ast)
        }
      }
    )*
  };
}

impl_quote_numeric_literal!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64);

impl<'a> QuoteInterpolation<'a> for Expression<'a> {
  fn into_quoted_interpolation(self, _ast: &impl GetAstBuilder<'a>, _span: Span) -> Expression<'a> {
    self
  }
}

impl<'a> QuoteInterpolation<'a> for &'a str {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    quote_literal(ast, span, self)
  }
}

impl<'a> QuoteInterpolation<'a> for String {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    quote_literal(ast, span, self)
  }
}

impl<'a> QuoteInterpolation<'a> for Str<'a> {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    quote_literal(ast, span, self)
  }
}

impl<'a> QuoteInterpolation<'a> for Ident<'a> {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_identifier(span, self, ast)
  }
}

impl<'a> QuoteInterpolation<'a> for bool {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    quote_literal(ast, span, self)
  }
}

macro_rules! impl_quote_numeric_interpolation {
  ($($ty:ty),* $(,)?) => {
    $(
      impl<'a> QuoteInterpolation<'a> for $ty {
        fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
          quote_literal(ast, span, self)
        }
      }
    )*
  };
}

impl_quote_numeric_interpolation!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64);

impl<'a, T> QuoteInterpolation<'a> for Vec<'a, T>
where
  T: Into<ArrayExpressionElement<'a>>,
{
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_array_expression(
      span,
      Vec::from_iter_in(self.into_iter().map(Into::into), ast.builder()),
      ast,
    )
  }
}

impl<'a, T> QuoteStatements<'a> for T
where
  T: IntoIterator<Item = Statement<'a>>,
{
  fn into_quoted_statements(
    self,
    ast: &impl GetAstBuilder<'a>,
    _span: Span,
  ) -> Vec<'a, Statement<'a>> {
    Vec::from_iter_in(self, ast.builder())
  }
}

#[doc(hidden)]
pub fn quote_const_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  name: T,
  init: Expression<'a>,
) -> Statement<'a>
where
  T: QuoteBindingName<'a>,
{
  Statement::new_variable_declaration(
    span,
    VariableDeclarationKind::Const,
    Vec::from_value_in(
      VariableDeclarator::new(
        span,
        VariableDeclarationKind::Const,
        BindingPattern::new_binding_identifier(span, quote_binding_name(ast, name), ast),
        NONE,
        Some(init),
        false,
        ast,
      ),
      ast.builder(),
    ),
    false,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_var_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  name: T,
  init: Expression<'a>,
) -> Statement<'a>
where
  T: QuoteBindingName<'a>,
{
  Statement::new_variable_declaration(
    span,
    VariableDeclarationKind::Var,
    Vec::from_value_in(
      VariableDeclarator::new(
        span,
        VariableDeclarationKind::Var,
        BindingPattern::new_binding_identifier(span, quote_binding_name(ast, name), ast),
        NONE,
        Some(init),
        false,
        ast,
      ),
      ast.builder(),
    ),
    false,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_export_const_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  name: T,
  init: Expression<'a>,
) -> Statement<'a>
where
  T: QuoteBindingName<'a>,
{
  Statement::new_export_named_declaration(
    span,
    Some(Declaration::new_variable_declaration(
      span,
      VariableDeclarationKind::Const,
      Vec::from_value_in(
        VariableDeclarator::new(
          span,
          VariableDeclarationKind::Const,
          BindingPattern::new_binding_identifier(span, quote_binding_name(ast, name), ast),
          NONE,
          Some(init),
          false,
          ast,
        ),
        ast.builder(),
      ),
      false,
      ast,
    )),
    Vec::new_in(ast.builder()),
    None,
    ImportOrExportKind::Value,
    NONE,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_import_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  source: T,
) -> Statement<'a>
where
  T: QuoteModuleSource<'a>,
{
  Statement::new_import_declaration(
    span,
    None,
    quote_module_source(ast, span, source),
    None,
    NONE,
    ImportOrExportKind::Value,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_import_default_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  local_name: impl QuoteBindingName<'a>,
  source: T,
) -> Statement<'a>
where
  T: QuoteModuleSource<'a>,
{
  Statement::new_import_declaration(
    span,
    Some(Vec::from_value_in(
      ImportDeclarationSpecifier::new_import_default_specifier(
        span,
        BindingIdentifier::new(span, quote_binding_name(ast, local_name), ast),
        ast,
      ),
      ast.builder(),
    )),
    quote_module_source(ast, span, source),
    None,
    NONE,
    ImportOrExportKind::Value,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_import_namespace_statement<'a, T>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  local_name: impl QuoteBindingName<'a>,
  source: T,
) -> Statement<'a>
where
  T: QuoteModuleSource<'a>,
{
  Statement::new_import_declaration(
    span,
    Some(Vec::from_value_in(
      ImportDeclarationSpecifier::new_import_namespace_specifier(
        span,
        BindingIdentifier::new(span, quote_binding_name(ast, local_name), ast),
        ast,
      ),
      ast.builder(),
    )),
    quote_module_source(ast, span, source),
    None,
    NONE,
    ImportOrExportKind::Value,
    ast,
  )
}

#[doc(hidden)]
#[allow(dead_code)]
pub fn quote_object_property_shorthand<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  name: impl QuoteBindingName<'a>,
) -> oxc_ast::ast::ObjectPropertyKind<'a> {
  let name = quote_binding_name(ast, name);
  ObjectPropertyKind::new_object_property(
    span,
    oxc_ast::ast::PropertyKind::Init,
    PropertyKey::new_static_identifier(span, name, ast),
    Expression::new_identifier(span, name, ast),
    false,
    true,
    false,
    ast,
  )
}

#[doc(hidden)]
#[allow(dead_code)]
pub fn quote_object_property_named<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  key: impl QuoteBindingName<'a>,
  value: Expression<'a>,
) -> oxc_ast::ast::ObjectPropertyKind<'a> {
  ObjectPropertyKind::new_object_property(
    span,
    oxc_ast::ast::PropertyKind::Init,
    PropertyKey::new_static_identifier(span, quote_binding_name(ast, key), ast),
    value,
    false,
    false,
    false,
    ast,
  )
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_module_source {
  ($ast:expr, @{$ident:ident}) => {
    $ident
  };
  ($ast:expr, @$literal:literal) => {{
    let __ast = $ast;
    oxc_str::format_str!(oxc_allocator::GetAllocator::allocator(__ast), $literal)
  }};
  ($ast:expr, $literal:literal) => {
    $literal
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_binding_name {
  ($ast:expr, @{$ident:ident}) => {
    $ident
  };
  ($ast:expr, @$literal:literal) => {{
    let __ast = $ast;
    oxc_str::format_ident!(oxc_allocator::GetAllocator::allocator(__ast), $literal)
  }};
  ($ast:expr, $ident:ident) => {
    stringify!($ident)
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_array_element {
  ($ast:expr, $span:ident, $($value:tt)+) => {
    oxc_ast::ast::ArrayExpressionElement::from($crate::quote_expr!($ast, $span, $($value)+))
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_property {
  ($ast:expr, $span:ident, @{$key:ident}) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_object_property_shorthand(__ast, __span, $key)
  }};
  ($ast:expr, $span:ident, @{$key:ident} : $($value:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_object_property_named(
      __ast,
      __span,
      $key,
      $crate::quote_expr!(__ast, __span, $($value)+),
    )
  }};
  ($ast:expr, $span:ident, $key:ident) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_object_property_shorthand(__ast, __span, stringify!($key))
  }};
  ($ast:expr, $span:ident, $key:ident : $($value:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_object_property_named(
      __ast,
      __span,
      stringify!($key),
      $crate::quote_expr!(__ast, __span, $($value)+),
    )
  }};
  ($ast:expr, $span:ident, $key:literal : $($value:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::ObjectPropertyKind::new_object_property(
      __span,
      oxc_ast::ast::PropertyKind::Init,
      oxc_ast::ast::PropertyKey::StringLiteral(oxc_ast::ast::StringLiteral::boxed(
        __span,
        $key,
        None,
        __ast,
      )),
      $crate::quote_expr!(__ast, __span, $($value)+),
      false,
      false,
      false,
      __ast,
    )
  }};
  ($ast:expr, $span:ident, @$key:literal : $($value:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::ObjectPropertyKind::new_object_property(
      __span,
      oxc_ast::ast::PropertyKind::Init,
      oxc_ast::ast::PropertyKey::StringLiteral(oxc_ast::ast::StringLiteral::boxed(
        __span,
        oxc_str::format_str!(oxc_allocator::GetAllocator::allocator(__ast), $key),
        None,
        __ast,
      )),
      $crate::quote_expr!(__ast, __span, $($value)+),
      false,
      false,
      false,
      __ast,
    )
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_array_elements_array {
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [] ; ) => {
    [$($elements,)*]
  };
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($elements,)* $crate::__quote_array_element!($ast, $span, $($current)+),]
  };
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [] ; ,) => {
    [$($elements,)*]
  };
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($elements,)* $crate::__quote_array_element!($ast, $span, $($current)+),]
  };
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_array_elements_array!(
      $ast;
      $span;
      [$($elements,)* $crate::__quote_array_element!($ast, $span, $($current)+),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; $span:ident; [$($elements:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_array_elements_array!(
      $ast;
      $span;
      [$($elements,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_call_arguments_array {
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [] ; ) => {
    [$($arguments,)*]
  };
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $span, $($current)+)),]
  };
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [] ; ,) => {
    [$($arguments,)*]
  };
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $span, $($current)+)),]
  };
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_call_arguments_array!(
      $ast;
      $span;
      [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $span, $($current)+)),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; $span:ident; [$($arguments:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_call_arguments_array!(
      $ast;
      $span;
      [$($arguments,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_properties_array {
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [] ; ) => {
    [$($properties,)*]
  };
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($properties,)* $crate::__quote_object_property!($ast, $span, $($current)+),]
  };
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [] ; ,) => {
    [$($properties,)*]
  };
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($properties,)* $crate::__quote_object_property!($ast, $span, $($current)+),]
  };
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_object_properties_array!(
      $ast;
      $span;
      [$($properties,)* $crate::__quote_object_property!($ast, $span, $($current)+),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; $span:ident; [$($properties:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_object_properties_array!(
      $ast;
      $span;
      [$($properties,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_arrow_parameters {
  ($ast:expr; $span:ident; [$($params:expr,)*] ; ) => {{
    let __ast = $ast;
    (oxc_allocator::ArenaVec::from_array_in([$($params,)*], __ast), None)
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; ...@{$rest:ident} $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([$($params,)*], __ast),
      Some($crate::quote::quote_binding_name(
        __ast,
        $crate::__quote_binding_name!(__ast, @{$rest}),
      )),
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; ...@$rest:literal $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([$($params,)*], __ast),
      Some($crate::quote::quote_binding_name(
        __ast,
        $crate::__quote_binding_name!(__ast, @$rest),
      )),
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; ...$rest:tt $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([$($params,)*], __ast),
      Some($crate::quote::quote_binding_name(
        __ast,
        $crate::__quote_binding_name!(__ast, $rest),
      )),
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; @{$param:ident}, $($rest:tt)*) => {{
    let __ast = $ast;
    $crate::__quote_arrow_parameters!(
      __ast;
      $span;
      [$(
        $params,
      )* $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, @{$param})),];
      $($rest)*
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; $param:tt, $($rest:tt)*) => {{
    let __ast = $ast;
    $crate::__quote_arrow_parameters!(
      __ast;
      $span;
      [$(
        $params,
      )* $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param)),];
      $($rest)*
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; @{$param:ident} $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([
        $($params,)*
        $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, @{$param})),
      ], __ast),
      None,
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; @$param:literal $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([
        $($params,)*
        $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, @$param)),
      ], __ast),
      None,
    )
  }};
  ($ast:expr; $span:ident; [$($params:expr,)*] ; $param:tt $(,)?) => {{
    let __ast = $ast;
    (
      oxc_allocator::ArenaVec::from_array_in([
        $($params,)*
        $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param)),
      ], __ast),
      None,
    )
  }};
}

#[doc(hidden)]
pub fn quote_static_member_expression<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  object: Expression<'a>,
  property: impl QuoteBindingName<'a>,
) -> Expression<'a> {
  Expression::new_static_member_expression(
    span,
    object,
    IdentifierName::new(span, quote_binding_name(ast, property), ast),
    false,
    ast,
  )
}

#[doc(hidden)]
pub fn quote_computed_member_expression<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  object: Expression<'a>,
  property: Expression<'a>,
) -> Expression<'a> {
  Expression::new_computed_member_expression(span, object, property, false, ast)
}

#[doc(hidden)]
pub fn quote_call_expression<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  callee: Expression<'a>,
  arguments: Vec<'a, Argument<'a>>,
) -> Expression<'a> {
  Expression::new_call_expression(span, callee, NONE, arguments, false, ast)
}

#[doc(hidden)]
pub fn quote_assignment_expression<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  left: AssignmentTarget<'a>,
  right: Expression<'a>,
) -> Expression<'a> {
  Expression::new_assignment_expression(span, AssignmentOperator::Assign, left, right, ast)
}

#[doc(hidden)]
pub fn quote_arrow_function_expression<'a, I>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  parameters: I,
  rest_parameter: Option<Ident<'a>>,
  body: Expression<'a>,
) -> Expression<'a>
where
  I: IntoIterator<Item = Ident<'a>>,
{
  Expression::new_arrow_function_expression(
    span,
    true,
    false,
    NONE,
    FormalParameters::new(
      span,
      FormalParameterKind::ArrowFormalParameters,
      Vec::from_iter_in(
        parameters.into_iter().map(|name| {
          FormalParameter::new(
            span,
            Vec::new_in(ast.builder()),
            BindingPattern::new_binding_identifier(span, name, ast),
            NONE,
            NONE,
            false,
            None,
            false,
            false,
            ast,
          )
        }),
        ast.builder(),
      ),
      rest_parameter.map(|name| {
        FormalParameterRest::new(
          span,
          Vec::new_in(ast.builder()),
          BindingRestElement::new(
            span,
            BindingPattern::new_binding_identifier(span, name, ast),
            ast,
          ),
          NONE,
          ast,
        )
      }),
      ast,
    ),
    NONE,
    FunctionBody::new(
      span,
      Vec::new_in(ast.builder()),
      Vec::from_value_in(
        Statement::new_expression_statement(span, body, ast),
        ast.builder(),
      ),
      ast,
    ),
    ast,
  )
}

#[doc(hidden)]
pub fn quote_arrow_function_block_expression<'a, I>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  parameters: I,
  rest_parameter: Option<Ident<'a>>,
  body: Vec<'a, Statement<'a>>,
) -> Expression<'a>
where
  I: IntoIterator<Item = Ident<'a>>,
{
  Expression::new_arrow_function_expression(
    span,
    false,
    false,
    NONE,
    FormalParameters::new(
      span,
      FormalParameterKind::ArrowFormalParameters,
      Vec::from_iter_in(
        parameters.into_iter().map(|name| {
          FormalParameter::new(
            span,
            Vec::new_in(ast.builder()),
            BindingPattern::new_binding_identifier(span, name, ast),
            NONE,
            NONE,
            false,
            None,
            false,
            false,
            ast,
          )
        }),
        ast.builder(),
      ),
      rest_parameter.map(|name| {
        FormalParameterRest::new(
          span,
          Vec::new_in(ast.builder()),
          BindingRestElement::new(
            span,
            BindingPattern::new_binding_identifier(span, name, ast),
            ast,
          ),
          NONE,
          ast,
        )
      }),
      ast,
    ),
    NONE,
    FunctionBody::new(span, Vec::new_in(ast.builder()), body, ast),
    ast,
  )
}

#[doc(hidden)]
pub fn quote_expression_statement<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  expression: Expression<'a>,
) -> Statement<'a> {
  Statement::new_expression_statement(span, expression, ast)
}

#[doc(hidden)]
pub fn quote_block_statement<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  body: Vec<'a, Statement<'a>>,
) -> Statement<'a> {
  Statement::new_block_statement(span, body, ast)
}

#[doc(hidden)]
pub fn quote_return_statement<'a>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  argument: Option<Expression<'a>>,
) -> Statement<'a> {
  Statement::new_return_statement(span, argument, ast)
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_atom {
  ($ast:expr, $span:ident, @$literal:literal) => {{
    let __ast = $ast;
    let __span = $span;
    let __value = oxc_str::format_str!(oxc_allocator::GetAllocator::allocator(__ast), $literal);
    $crate::quote::quote_literal(__ast, __span, __value)
  }};
  ($ast:expr, $span:ident, [@{$items:ident}]) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_array_expression(__ast, __span, $items)
  }};
  ($ast:expr, $span:ident, [$($items:tt)*]) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_array_expression(
      __span,
      oxc_allocator::ArenaVec::from_array_in(
        $crate::__quote_array_elements_array!(__ast; __span; []; []; $($items)*),
        __ast,
      ),
      __ast,
    )
  }};
  ($ast:expr, $span:ident, @{$ident:ident}) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_interpolation(__ast, __span, $ident)
  }};
  ($ast:expr, $span:ident, {$($props:tt)*}) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_object_expression(
      __span,
      oxc_allocator::ArenaVec::from_array_in(
        $crate::__quote_object_properties_array!(__ast; __span; []; []; $($props)*),
        __ast,
      ),
      __ast,
    )
  }};
  ($ast:expr, $span:ident, ($($value:tt)*)) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_parenthesized_expression(
      __span,
      $crate::quote_expr!(__ast, __span, $($value)*),
      __ast,
    )
  }};
  ($ast:expr, $span:ident, null) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_null_literal(__span, __ast)
  }};
  ($ast:expr, $span:ident, undefined) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_identifier(__span, "undefined", __ast)
  }};
  ($ast:expr, $span:ident, $literal:literal) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_literal(__ast, __span, $literal)
  }};
  ($ast:expr, $span:ident, $ident:ident) => {{
    let __ast = $ast;
    let __span = $span;
    oxc_ast::ast::Expression::new_identifier(__span, stringify!($ident), __ast)
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_postfix {
  ($ast:expr, $span:ident, $expr:expr,) => {
    $expr
  };
  ($ast:expr, $span:ident, $expr:expr, . @$property:literal $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::quote::quote_static_member_expression(__ast, __span, $expr, $crate::__quote_binding_name!(__ast, @$property));
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $expr:expr, . @{$property:ident} $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::quote::quote_static_member_expression(__ast, __span, $expr, $property);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $expr:expr, . $property:ident $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr =
      $crate::quote::quote_static_member_expression(__ast, __span, $expr, stringify!($property));
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $expr:expr, [ $($property:tt)* ] $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::quote::quote_computed_member_expression(
      __ast,
      __span,
      $expr,
      $crate::quote_expr!(__ast, __span, $($property)*),
    );
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $expr:expr, ( $($arguments:tt)* ) $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::quote::quote_call_expression(
      __ast,
      __span,
      $expr,
      oxc_allocator::ArenaVec::from_array_in(
        $crate::__quote_call_arguments_array!(__ast; __span; []; []; $($arguments)*),
        __ast,
      ),
    );
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_statements_array {
  ($ast:expr; $span:ident; [$($statements:expr,)*]; []) => {
    [$($statements,)*]
  };
  ($ast:expr; $span:ident; [$($statements:expr,)*]; [$($statement:tt)+]) => {
    compile_error!("expected `;` after quoted statement")
  };
  ($ast:expr; $span:ident; [$($statements:expr,)*]; [$($statement:tt)*]; $($rest:tt)*) => {
    $crate::__quote_statements_array!(
      $ast;
      $span;
      [$($statements,)* $crate::quote_stmt!($ast, $span, $($statement)*;),];
      []
      $($rest)*
    )
  };
  ($ast:expr; $span:ident; [$($statements:expr,)*]; [$($statement:tt)*] $token:tt $($rest:tt)*) => {
    $crate::__quote_statements_array!(
      $ast;
      $span;
      [$($statements,)*];
      [$($statement)* $token]
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_parse {
  ($ast:expr, $span:ident, @{$target:ident} = $($value:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_assignment_expression(
      __ast,
      __span,
      $target,
      $crate::quote_expr!(__ast, __span, $($value)+),
    )
  }};
  ($ast:expr, $span:ident, ($($params:tt)*) => { @{$body:ident} }) => {{
    let __ast = $ast;
    let __span = $span;
    let (__params, __rest) = $crate::__quote_arrow_parameters!(__ast; __span; []; $($params)*);
    $crate::quote::quote_arrow_function_block_expression(
      __ast,
      __span,
      __params,
      __rest,
      $crate::quote::quote_statements(__ast, __span, $body),
    )
  }};
  ($ast:expr, $span:ident, ($($params:tt)*) => { $($body:tt)+ }) => {{
    let __ast = $ast;
    let __span = $span;
    let (__params, __rest) = $crate::__quote_arrow_parameters!(__ast; __span; []; $($params)*);
    $crate::quote::quote_arrow_function_block_expression(
      __ast,
      __span,
      __params,
      __rest,
      oxc_allocator::ArenaVec::from_array_in(
        $crate::__quote_statements_array!(__ast; __span; []; [] $($body)+),
        __ast,
      ),
    )
  }};
  ($ast:expr, $span:ident, ($($params:tt)*) => $($body:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    let (__params, __rest) = $crate::__quote_arrow_parameters!(__ast; __span; []; $($params)*);
    $crate::quote::quote_arrow_function_expression(
      __ast,
      __span,
      __params,
      __rest,
      $crate::quote_expr!(__ast, __span, $($body)+),
    )
  }};
  ($ast:expr, $span:ident, @{$param:ident} => { @{$body:ident} }) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_arrow_function_block_expression(
      __ast,
      __span,
      [$crate::__quote_binding_name!(__ast, @{$param})],
      None,
      $crate::quote::quote_statements(__ast, __span, $body),
    )
  }};
  ($ast:expr, $span:ident, @{$param:ident} => $($body:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_arrow_function_expression(
      __ast,
      __span,
      [$crate::__quote_binding_name!(__ast, @{$param})],
      None,
      $crate::quote_expr!(__ast, __span, $($body)+),
    )
  }};
  ($ast:expr, $span:ident, $param:tt => { @{$body:ident} }) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_arrow_function_block_expression(
      __ast,
      __span,
      [$crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param))],
      None,
      $crate::quote::quote_statements(__ast, __span, $body),
    )
  }};
  ($ast:expr, $span:ident, $param:tt => $($body:tt)+) => {{
    let __ast = $ast;
    let __span = $span;
    $crate::quote::quote_arrow_function_expression(
      __ast,
      __span,
      [$crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param))],
      None,
      $crate::quote_expr!(__ast, __span, $($body)+),
    )
  }};
  ($ast:expr, $span:ident, @$literal:literal $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, @$literal);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, [$($items:tt)*] $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, [$($items)*]);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, @{$ident:ident} $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, @{$ident});
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, {$($props:tt)*} $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, {$($props)*});
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, ($($value:tt)*) $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, ($($value)*));
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, null $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, null);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, undefined $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, undefined);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $literal:literal $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, $literal);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
  ($ast:expr, $span:ident, $ident:ident $($rest:tt)*) => {{
    let __ast = $ast;
    let __span = $span;
    let __expr = $crate::__quote_expr_atom!(__ast, __span, $ident);
    $crate::__quote_expr_postfix!(__ast, __span, __expr, $($rest)*)
  }};
}

#[macro_export]
macro_rules! quote_expr {
  ($allocator:expr, $span:ident, $($value:tt)+) => {{
    let __quote_ast = {
      #[allow(unused_imports)]
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    $crate::__quote_expr_parse!(__ast, $span, $($value)+)
  }};
  ($allocator:expr, $($value:tt)+) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    const SPAN: oxc_span::Span = oxc_span::SPAN;
    $crate::__quote_expr_parse!(__ast, SPAN, $($value)+)
  }};
}

#[macro_export]
macro_rules! __quote_decl_statement {
  ($ast:expr, $span:ident, $builder:path, $name:expr, ($($value:tt)+)) => {{
    let __ast = $ast;
    let __span = $span;
    $builder(__ast, __span, $name, $crate::quote_expr!(__ast, __span, $($value)+))
  }};
}

#[macro_export]
macro_rules! quote_stmt {
  ($allocator:expr, $span:ident, @{$statement:ident};) => {
    $statement
  };
  ($allocator:expr, $span:ident, { @{$body:ident} }) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_block_statement(
      __ast,
      __span,
      $crate::quote::quote_statements(__ast, __span, $body),
    )
  }};
  ($allocator:expr, $span:ident, ($($expr:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_expression_statement(
      __ast,
      __span,
      $crate::quote_expr!(__ast, __span, $($expr)+),
    )
  }};
  ($allocator:expr, $span:ident, import @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_statement(
      __ast,
      __span,
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_statement(__ast, __span, $source)
  }};
  ($allocator:expr, $span:ident, import $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_statement(
      __ast,
      __span,
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import * as @$local:literal from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import * as @$local:literal from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $source,
    )
  }};
  ($allocator:expr, $span:ident, import * as @$local:literal from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import * as @{$local:ident} from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $local,
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import * as $local:tt from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import * as @{$local:ident} from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(__ast, __span, $local, $source)
  }};
  ($allocator:expr, $span:ident, import * as @{$local:ident} from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $local,
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import * as $local:tt from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $source,
    )
  }};
  ($allocator:expr, $span:ident, import * as $local:tt from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_namespace_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import @$local:literal from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import @$local:literal from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $source,
    )
  }};
  ($allocator:expr, $span:ident, import @$local:literal from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, @$local),
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import @{$local:ident} from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $local,
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import $local:tt from @$source:literal;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $crate::__quote_module_source!(__ast, @$source),
    )
  }};
  ($allocator:expr, $span:ident, import @{$local:ident} from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(__ast, __span, $local, $source)
  }};
  ($allocator:expr, $span:ident, import @{$local:ident} from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $local,
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, import $local:tt from @{$source:ident};) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $source,
    )
  }};
  ($allocator:expr, $span:ident, import $local:tt from $source:tt;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_import_default_statement(
      __ast,
      __span,
      $crate::__quote_binding_name!(__ast, $local),
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($allocator:expr, $span:ident, const @$name:literal = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_const_statement,
      $crate::__quote_binding_name!(__ast, @$name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, const @{$name:ident} = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_const_statement,
      $name,
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, const $name:ident = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_const_statement,
      $crate::__quote_binding_name!(__ast, $name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, var @$name:literal = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_var_statement,
      $crate::__quote_binding_name!(__ast, @$name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, var @{$name:ident} = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_var_statement,
      $name,
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, var $name:ident = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_var_statement,
      $crate::__quote_binding_name!(__ast, $name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, export const @$name:literal = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_export_const_statement,
      $crate::__quote_binding_name!(__ast, @$name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, export const @{$name:ident} = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_export_const_statement,
      $name,
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, export const $name:ident = ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::__quote_decl_statement!(
      __ast,
      __span,
      $crate::quote::quote_export_const_statement,
      $crate::__quote_binding_name!(__ast, $name),
      ($($value)+)
    )
  }};
  ($allocator:expr, $span:ident, return;) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_return_statement(__ast, __span, None)
  }};
  ($allocator:expr, $span:ident, return ($($value:tt)+);) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    let __span = $span;
    $crate::quote::quote_return_statement(
      __ast,
      __span,
      Some($crate::quote_expr!(__ast, __span, $($value)+)),
    )
  }};
  ($allocator:expr, $($value:tt)+) => {{
    let __quote_ast = {
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($allocator).builder())
    };
    let __ast = &__quote_ast;
    const SPAN: oxc_span::Span = oxc_span::SPAN;
    $crate::quote_stmt!(__ast, SPAN, $($value)+)
  }};
}

#[cfg(test)]
mod tests {
  use oxc_allocator::{Allocator, Vec as ArenaVec};
  use oxc_ast::{
    ast::{
      ArrayExpressionElement, AssignmentTarget, Expression, ObjectPropertyKind, PropertyKey,
      Statement,
    },
    builder::AstBuilder,
  };
  use oxc_span::{SPAN, Span};
  use oxc_str::{Ident, Str};

  #[test]
  fn quote_builds_nested_literals_and_interpolations() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let label: Str = "label".into();
    let dynamic_key: Ident = "dynamicKey".into();
    let count = 3u32;
    let values = ArenaVec::from_iter_in(
      [1u32, 2u32]
        .into_iter()
        .map(|value| ArrayExpressionElement::from(crate::quote::quote_literal(&ast, SPAN, value))),
      &ast,
    );

    let quoted = crate::quote_expr!(ast, {
      items: [1, "two", true, null, undefined, @{value}, @{label}, @{count}],
      values: @{values},
      nested: {
        answer: 42,
        "label": "ok",
        @{dynamic_key}: "value",
        @{dynamic_key},
      },
    });

    let Expression::ObjectExpression(object) = quoted else {
      panic!("expected object expression");
    };

    let ObjectPropertyKind::ObjectProperty(items) = &object.properties[0] else {
      panic!("expected object property");
    };
    let Expression::ArrayExpression(items_value) = &items.value else {
      panic!("expected array expression");
    };
    let ArrayExpressionElement::BooleanLiteral(boolean) = &items_value.elements[2] else {
      panic!("expected boolean literal");
    };
    assert!(boolean.value);
    let ArrayExpressionElement::Identifier(undefined) = &items_value.elements[4] else {
      panic!("expected undefined identifier");
    };
    assert_eq!(undefined.name.as_str(), "undefined");
    let ArrayExpressionElement::StringLiteral(label) = &items_value.elements[6] else {
      panic!("expected interpolated string literal");
    };
    assert_eq!(label.value.as_str(), "label");
    let ArrayExpressionElement::NumericLiteral(count) = &items_value.elements[7] else {
      panic!("expected interpolated numeric literal");
    };
    assert_eq!(count.value, 3.0);

    let ObjectPropertyKind::ObjectProperty(values) = &object.properties[1] else {
      panic!("expected values property");
    };
    let Expression::ArrayExpression(values_value) = &values.value else {
      panic!("expected interpolated array expression");
    };
    assert_eq!(values_value.elements.len(), 2);

    let ObjectPropertyKind::ObjectProperty(nested) = &object.properties[2] else {
      panic!("expected nested object property");
    };
    let Expression::ObjectExpression(nested_value) = &nested.value else {
      panic!("expected nested object expression");
    };
    let ObjectPropertyKind::ObjectProperty(label) = &nested_value.properties[1] else {
      panic!("expected label property");
    };
    assert!(matches!(label.key, PropertyKey::StringLiteral(_)));
    let ObjectPropertyKind::ObjectProperty(dynamic_named) = &nested_value.properties[2] else {
      panic!("expected dynamic named property");
    };
    assert!(matches!(
      dynamic_named.key,
      PropertyKey::StaticIdentifier(_)
    ));
    let ObjectPropertyKind::ObjectProperty(dynamic_shorthand) = &nested_value.properties[3] else {
      panic!("expected dynamic shorthand property");
    };
    assert!(dynamic_shorthand.shorthand);
  }

  #[test]
  fn quote_builds_top_level_literals_and_interpolations() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let target = AssignmentTarget::new_assignment_target_identifier(SPAN, "target", &ast);
    let index = 3u32;

    let string = crate::quote_expr!(ast, "label");
    let prefixed_formatted = crate::quote_expr!(ast, @"css-{index}");
    let number = crate::quote_expr!(ast, 42);
    let boolean = crate::quote_expr!(ast, true);
    let interpolated = crate::quote_expr!(ast, @{value});
    let assignment = crate::quote_expr!(ast, @{target} = "assigned");

    assert!(matches!(string, Expression::StringLiteral(_)));
    let Expression::StringLiteral(prefixed_formatted) = prefixed_formatted else {
      panic!("expected prefixed formatted string literal");
    };
    assert_eq!(prefixed_formatted.value.as_str(), "css-3");
    assert!(matches!(number, Expression::NumericLiteral(_)));
    assert!(matches!(boolean, Expression::BooleanLiteral(_)));
    assert!(matches!(interpolated, Expression::Identifier(_)));
    assert!(matches!(assignment, Expression::AssignmentExpression(_)));
  }

  #[test]
  fn quote_builds_postfix_expressions() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let call_value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let nested_value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let key: Str = "key".into();
    let property: Ident = "primary".into();

    let member = crate::quote_expr!(ast, theme.colors.primary);
    let formatted_member = crate::quote_expr!(ast, theme.colors.@"color-{key}");
    let interpolated_member = crate::quote_expr!(ast, theme.colors.@{property});
    let computed = crate::quote_expr!(ast, theme.colors[@{key}]);
    let call = crate::quote_expr!(ast, theme.colors.getPrimary(@{call_value}, [1, theme.gap]));
    let nested = crate::quote_expr!(ast, {
      member: theme.colors.primary,
      interpolatedMember: theme.colors.@{property},
      computed: theme.colors[@{key}],
      call: theme.colors.getPrimary(@{nested_value}, [1, theme.gap]),
    });

    assert!(matches!(member, Expression::StaticMemberExpression(_)));
    assert!(matches!(
      formatted_member,
      Expression::StaticMemberExpression(_)
    ));
    assert!(matches!(
      interpolated_member,
      Expression::StaticMemberExpression(_)
    ));
    assert!(matches!(computed, Expression::ComputedMemberExpression(_)));
    assert!(matches!(call, Expression::CallExpression(_)));
    assert!(matches!(nested, Expression::ObjectExpression(_)));
  }

  #[test]
  fn quote_builds_arrow_functions() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let param: Ident = "value".into();
    let first: Ident = "first".into();
    let rest: Ident = "rest".into();
    let block_value = Expression::new_identifier(oxc_span::SPAN, "blockValue", &ast);
    let block_body = ArenaVec::from_value_in(crate::quote_stmt!(ast, (@{block_value});), &ast);

    let single = crate::quote_expr!(ast, value => value);
    let multi = crate::quote_expr!(ast, (first, second, ...rest) => first);
    let only_rest = crate::quote_expr!(ast, (...rest) => rest);
    let interpolated_single = crate::quote_expr!(ast, @{param} => @{param});
    let interpolated_multi = crate::quote_expr!(ast, (@{first}, second, ...@{rest}) => @{first});
    let block = crate::quote_expr!(ast, () => { @{block_body} });

    let Expression::ArrowFunctionExpression(single) = single else {
      panic!("expected single-parameter arrow function");
    };
    assert_eq!(single.params.items.len(), 1);
    assert!(single.params.rest.is_none());

    let Expression::ArrowFunctionExpression(multi) = multi else {
      panic!("expected multi-parameter arrow function");
    };
    assert_eq!(multi.params.items.len(), 2);
    assert!(multi.params.rest.is_some());

    let Expression::ArrowFunctionExpression(only_rest) = only_rest else {
      panic!("expected rest-only arrow function");
    };
    assert_eq!(only_rest.params.items.len(), 0);
    assert!(only_rest.params.rest.is_some());

    let Expression::ArrowFunctionExpression(interpolated_single) = interpolated_single else {
      panic!("expected interpolated single-parameter arrow function");
    };
    assert_eq!(interpolated_single.params.items.len(), 1);

    let Expression::ArrowFunctionExpression(interpolated_multi) = interpolated_multi else {
      panic!("expected interpolated multi-parameter arrow function");
    };
    assert_eq!(interpolated_multi.params.items.len(), 2);
    assert!(interpolated_multi.params.rest.is_some());

    let Expression::ArrowFunctionExpression(block) = block else {
      panic!("expected block-body arrow function");
    };
    assert_eq!(block.params.items.len(), 0);
    assert_eq!(block.body.statements.len(), 1);
  }

  #[test]
  fn quote_builds_basic_statements() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let source: Str = "./styles.css".into();
    let side_effect_source: Str = "./reset.css".into();
    let export_name: Ident = "dynamicStyles".into();
    let import_name: Ident = "dynamicImport".into();
    let value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let single_array_values =
      std::iter::once(Expression::new_identifier(oxc_span::SPAN, "value", &ast));
    let paren_value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
    let return_value = Expression::new_identifier(oxc_span::SPAN, "returnValue", &ast);
    let statement_value = Expression::new_identifier(oxc_span::SPAN, "statementValue", &ast);
    let block_value = Expression::new_identifier(oxc_span::SPAN, "blockValue", &ast);
    let block_body = ArenaVec::from_value_in(crate::quote_stmt!(ast, (@{block_value});), &ast);
    let lines = ArenaVec::from_array_in([1u32, 2u32, 3u32], &ast);
    let index = 3u32;

    let import = crate::quote_stmt!(ast, import styles from @{source};);
    let side_effect_import = crate::quote_stmt!(ast, import @{side_effect_source};);
    let formatted_import = crate::quote_stmt!(ast, import styles from @"./styles-{index}.css";);
    let formatted_binding_import =
      crate::quote_stmt!(ast, import @"styles_{index}" from @{source};);
    let namespace_import = crate::quote_stmt!(ast, import * as styles_ns from @{source};);
    let interpolated_import = crate::quote_stmt!(ast, import @{import_name} from @{source};);
    let interpolated_namespace_import =
      crate::quote_stmt!(ast, import * as @{import_name} from @{source};);
    let const_decl = crate::quote_stmt!(ast, const styles = (@{value}););
    let interpolated_const_decl = crate::quote_stmt!(ast, const @{export_name} = ("ok"););
    let paren_const_decl =
      crate::quote_stmt!(ast, const styles = (theme.colors.getPrimary(@{paren_value})););
    let array_const_decl = crate::quote_stmt!(ast, const styles = ([1, "two"]););
    let export_decl = crate::quote_stmt!(ast, export const styles = ("ok"););
    let interpolated_export_decl = crate::quote_stmt!(ast, export const @{export_name} = ("ok"););
    let formatted_export_decl = crate::quote_stmt!(ast, export const @"styles_{index}" = ("ok"););
    let paren_export_decl = crate::quote_stmt!(ast, export const styles = (theme.colors.primary););
    let return_stmt = crate::quote_stmt!(ast, return (@{return_value}););
    let empty_return_stmt = crate::quote_stmt!(ast, return;);
    let expression_stmt = crate::quote_stmt!(ast, (@{statement_value}););
    let block_stmt = crate::quote_stmt!(ast, { @{block_body} });
    let single_array_splice = crate::quote_expr!(ast, [@{single_array_values}]);
    let array_splice = crate::quote_expr!(ast, [@{lines}]);

    assert!(matches!(import, Statement::ImportDeclaration(_)));
    assert!(matches!(
      side_effect_import,
      Statement::ImportDeclaration(_)
    ));
    assert!(matches!(formatted_import, Statement::ImportDeclaration(_)));
    assert!(matches!(
      formatted_binding_import,
      Statement::ImportDeclaration(_)
    ));
    assert!(matches!(namespace_import, Statement::ImportDeclaration(_)));
    assert!(matches!(
      interpolated_import,
      Statement::ImportDeclaration(_)
    ));
    assert!(matches!(
      interpolated_namespace_import,
      Statement::ImportDeclaration(_)
    ));
    assert!(matches!(const_decl, Statement::VariableDeclaration(_)));
    assert!(matches!(
      interpolated_const_decl,
      Statement::VariableDeclaration(_)
    ));
    assert!(matches!(
      paren_const_decl,
      Statement::VariableDeclaration(_)
    ));
    assert!(matches!(
      array_const_decl,
      Statement::VariableDeclaration(_)
    ));
    assert!(matches!(export_decl, Statement::ExportNamedDeclaration(_)));
    assert!(matches!(
      interpolated_export_decl,
      Statement::ExportNamedDeclaration(_)
    ));
    assert!(matches!(
      formatted_export_decl,
      Statement::ExportNamedDeclaration(_)
    ));
    assert!(matches!(
      paren_export_decl,
      Statement::ExportNamedDeclaration(_)
    ));
    assert!(matches!(return_stmt, Statement::ReturnStatement(_)));
    assert!(matches!(empty_return_stmt, Statement::ReturnStatement(_)));
    assert!(matches!(expression_stmt, Statement::ExpressionStatement(_)));
    assert!(matches!(block_stmt, Statement::BlockStatement(_)));
    assert!(matches!(
      single_array_splice,
      Expression::ArrayExpression(_)
    ));
    assert!(matches!(array_splice, Expression::ArrayExpression(_)));
  }

  #[test]
  fn quote_applies_custom_spans() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let span = Span::new(10, 20);

    let expr = crate::quote_expr!(ast, span, { values: [1, "two"] });
    let stmt = crate::quote_stmt!(ast, span, import styles from @"./styles.css";);

    let Expression::ObjectExpression(object) = expr else {
      panic!("expected object expression");
    };
    assert_eq!(object.span, span);

    let ObjectPropertyKind::ObjectProperty(values) = &object.properties[0] else {
      panic!("expected object property");
    };
    assert_eq!(values.span, span);

    let Expression::ArrayExpression(array) = &values.value else {
      panic!("expected array expression");
    };
    assert_eq!(array.span, span);

    let ArrayExpressionElement::NumericLiteral(number) = &array.elements[0] else {
      panic!("expected numeric literal");
    };
    assert_eq!(number.span, span);

    let Statement::ImportDeclaration(import) = stmt else {
      panic!("expected import declaration");
    };
    assert_eq!(import.span, span);
    assert_eq!(import.source.span, span);
  }
}
