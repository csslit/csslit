use oxc_allocator::{FromIn, Vec};
use oxc_ast::{
  AstBuilder, NONE,
  ast::{
    Argument, ArrayExpressionElement, Expression, FormalParameterKind, ImportOrExportKind,
    Statement, StringLiteral, VariableDeclarationKind,
  },
};
use oxc_span::{Atom, SPAN};
use oxc_syntax::number::NumberBase;

#[doc(hidden)]
pub trait QuoteLiteral<'a> {
  fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a>;
}

#[doc(hidden)]
pub fn quote_literal<'a, T>(ast: AstBuilder<'a>, value: T) -> Expression<'a>
where
  T: QuoteLiteral<'a>,
{
  value.into_quoted_expression(ast)
}

#[doc(hidden)]
pub trait QuoteInterpolation<'a> {
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a>;
}

#[doc(hidden)]
pub fn quote_interpolation<'a, T>(ast: AstBuilder<'a>, value: T) -> Expression<'a>
where
  T: QuoteInterpolation<'a>,
{
  value.into_quoted_interpolation(ast)
}

#[doc(hidden)]
pub trait QuoteBindingName<'a> {
  fn into_quoted_binding_name(self, ast: AstBuilder<'a>) -> Atom<'a>;
}

#[doc(hidden)]
pub fn quote_binding_name<'a, T>(ast: AstBuilder<'a>, value: T) -> Atom<'a>
where
  T: QuoteBindingName<'a>,
{
  value.into_quoted_binding_name(ast)
}

#[doc(hidden)]
pub trait QuoteModuleSource<'a> {
  fn into_quoted_module_source(self, ast: AstBuilder<'a>) -> StringLiteral<'a>;
}

#[doc(hidden)]
pub fn quote_module_source<'a, T>(ast: AstBuilder<'a>, value: T) -> StringLiteral<'a>
where
  T: QuoteModuleSource<'a>,
{
  value.into_quoted_module_source(ast)
}

impl<'a> QuoteLiteral<'a> for &'a str {
  fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a> {
    ast.expression_string_literal(SPAN, self, None)
  }
}

impl<'a> QuoteLiteral<'a> for String {
  fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a> {
    ast.expression_string_literal(SPAN, Atom::from_in(self, ast.allocator), None)
  }
}

impl<'a> QuoteLiteral<'a> for Atom<'a> {
  fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a> {
    ast.expression_string_literal(SPAN, self, None)
  }
}

impl<'a> QuoteBindingName<'a> for &'a str {
  fn into_quoted_binding_name(self, _ast: AstBuilder<'a>) -> Atom<'a> {
    Atom::from(self)
  }
}

impl<'a> QuoteBindingName<'a> for String {
  fn into_quoted_binding_name(self, ast: AstBuilder<'a>) -> Atom<'a> {
    Atom::from_in(self, ast.allocator)
  }
}

impl<'a> QuoteBindingName<'a> for Atom<'a> {
  fn into_quoted_binding_name(self, _ast: AstBuilder<'a>) -> Atom<'a> {
    self
  }
}

impl<'a> QuoteModuleSource<'a> for &'a str {
  fn into_quoted_module_source(self, ast: AstBuilder<'a>) -> StringLiteral<'a> {
    ast.string_literal(SPAN, self, None)
  }
}

impl<'a> QuoteModuleSource<'a> for String {
  fn into_quoted_module_source(self, ast: AstBuilder<'a>) -> StringLiteral<'a> {
    ast.string_literal(SPAN, Atom::from_in(self, ast.allocator), None)
  }
}

impl<'a> QuoteModuleSource<'a> for Atom<'a> {
  fn into_quoted_module_source(self, ast: AstBuilder<'a>) -> StringLiteral<'a> {
    ast.string_literal(SPAN, self, None)
  }
}

impl<'a> QuoteLiteral<'a> for bool {
  fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a> {
    ast.expression_boolean_literal(SPAN, self)
  }
}

macro_rules! impl_quote_numeric_literal {
  ($($ty:ty),* $(,)?) => {
    $(
      impl<'a> QuoteLiteral<'a> for $ty {
        fn into_quoted_expression(self, ast: AstBuilder<'a>) -> Expression<'a> {
          ast.expression_numeric_literal(SPAN, self as f64, None, NumberBase::Decimal)
        }
      }
    )*
  };
}

impl_quote_numeric_literal!(u8, u16, u32, u64, usize, i8, i16, i32, i64, isize, f32, f64);

impl<'a> QuoteInterpolation<'a> for Expression<'a> {
  fn into_quoted_interpolation(self, _ast: AstBuilder<'a>) -> Expression<'a> {
    self
  }
}

impl<'a> QuoteInterpolation<'a> for &'a str {
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
    quote_literal(ast, self)
  }
}

impl<'a> QuoteInterpolation<'a> for String {
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
    quote_literal(ast, self)
  }
}

impl<'a> QuoteInterpolation<'a> for Atom<'a> {
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
    quote_literal(ast, self)
  }
}

impl<'a> QuoteInterpolation<'a> for bool {
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
    quote_literal(ast, self)
  }
}

macro_rules! impl_quote_numeric_interpolation {
  ($($ty:ty),* $(,)?) => {
    $(
      impl<'a> QuoteInterpolation<'a> for $ty {
        fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
          quote_literal(ast, self)
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
  fn into_quoted_interpolation(self, ast: AstBuilder<'a>) -> Expression<'a> {
    ast.expression_array(SPAN, ast.vec_from_iter(self.into_iter().map(Into::into)))
  }
}

#[doc(hidden)]
pub fn quote_const_statement<'a, T>(
  ast: AstBuilder<'a>,
  name: T,
  init: Expression<'a>,
) -> Statement<'a>
where
  T: QuoteBindingName<'a>,
{
  Statement::from(ast.declaration_variable(
    SPAN,
    VariableDeclarationKind::Const,
    ast.vec1(ast.variable_declarator(
      SPAN,
      VariableDeclarationKind::Const,
      ast.binding_pattern_binding_identifier(SPAN, quote_binding_name(ast, name)),
      NONE,
      Some(init),
      false,
    )),
    false,
  ))
}

#[doc(hidden)]
pub fn quote_export_const_statement<'a, T>(
  ast: AstBuilder<'a>,
  name: T,
  init: Expression<'a>,
) -> Statement<'a>
where
  T: QuoteBindingName<'a>,
{
  Statement::from(ast.module_declaration_export_named_declaration(
    SPAN,
    Some(ast.declaration_variable(
      SPAN,
      VariableDeclarationKind::Const,
      ast.vec1(ast.variable_declarator(
        SPAN,
        VariableDeclarationKind::Const,
        ast.binding_pattern_binding_identifier(SPAN, quote_binding_name(ast, name)),
        NONE,
        Some(init),
        false,
      )),
      false,
    )),
    ast.vec(),
    None,
    ImportOrExportKind::Value,
    NONE,
  ))
}

#[doc(hidden)]
pub fn quote_import_default_statement<'a, T>(
  ast: AstBuilder<'a>,
  local_name: impl QuoteBindingName<'a>,
  source: T,
) -> Statement<'a>
where
  T: QuoteModuleSource<'a>,
{
  Statement::from(ast.module_declaration_import_declaration(
    SPAN,
    Some(
      ast.vec1(ast.import_declaration_specifier_import_default_specifier(
        SPAN,
        ast.binding_identifier(SPAN, quote_binding_name(ast, local_name)),
      )),
    ),
    quote_module_source(ast, source),
    None,
    NONE,
    ImportOrExportKind::Value,
  ))
}

#[doc(hidden)]
pub fn quote_object_property_shorthand<'a>(
  ast: AstBuilder<'a>,
  name: impl QuoteBindingName<'a>,
) -> oxc_ast::ast::ObjectPropertyKind<'a> {
  let name = quote_binding_name(ast, name);
  ast.object_property_kind_object_property(
    SPAN,
    oxc_ast::ast::PropertyKind::Init,
    ast.property_key_static_identifier(SPAN, name),
    ast.expression_identifier(SPAN, name),
    false,
    true,
    false,
  )
}

#[doc(hidden)]
pub fn quote_object_property_named<'a>(
  ast: AstBuilder<'a>,
  key: impl QuoteBindingName<'a>,
  value: Expression<'a>,
) -> oxc_ast::ast::ObjectPropertyKind<'a> {
  ast.object_property_kind_object_property(
    SPAN,
    oxc_ast::ast::PropertyKind::Init,
    ast.property_key_static_identifier(SPAN, quote_binding_name(ast, key)),
    value,
    false,
    false,
    false,
  )
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_module_source {
  ($ast:expr, {$ident:ident}) => {
    $ident
  };
  ($ast:expr, $literal:literal) => {
    $literal
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_binding_name {
  ($ast:expr, {$ident:ident}) => {
    $ident
  };
  ($ast:expr, $ident:ident) => {
    stringify!($ident)
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_array_element {
  ($ast:expr, $($value:tt)+) => {
    oxc_ast::ast::ArrayExpressionElement::from($crate::quote_expr!($ast, $($value)+))
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_property {
  ($ast:expr, {$key:ident}) => {{
    let __ast = $ast;
    $crate::quote::quote_object_property_shorthand(__ast, $key)
  }};
  ($ast:expr, {$key:ident} : $($value:tt)+) => {{
    let __ast = $ast;
    $crate::quote::quote_object_property_named(
      __ast,
      $key,
      $crate::quote_expr!(__ast, $($value)+),
    )
  }};
  ($ast:expr, $key:ident) => {{
    let __ast = $ast;
    $crate::quote::quote_object_property_shorthand(__ast, stringify!($key))
  }};
  ($ast:expr, $key:ident : $($value:tt)+) => {{
    let __ast = $ast;
    $crate::quote::quote_object_property_named(
      __ast,
      stringify!($key),
      $crate::quote_expr!(__ast, $($value)+),
    )
  }};
  ($ast:expr, $key:literal : $($value:tt)+) => {{
    let __ast = $ast;
    __ast.object_property_kind_object_property(
      oxc_span::SPAN,
      oxc_ast::ast::PropertyKind::Init,
      oxc_ast::ast::PropertyKey::StringLiteral(__ast.alloc_string_literal(
        oxc_span::SPAN,
        $key,
        None,
      )),
      $crate::quote_expr!(__ast, $($value)+),
      false,
      false,
      false,
    )
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_array_elements_array {
  ($ast:expr; [$($elements:expr,)*] ; [] ; ) => {
    [$($elements,)*]
  };
  ($ast:expr; [$($elements:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($elements,)* $crate::__quote_array_element!($ast, $($current)+),]
  };
  ($ast:expr; [$($elements:expr,)*] ; [] ; ,) => {
    [$($elements,)*]
  };
  ($ast:expr; [$($elements:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($elements,)* $crate::__quote_array_element!($ast, $($current)+),]
  };
  ($ast:expr; [$($elements:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_array_elements_array!(
      $ast;
      [$($elements,)* $crate::__quote_array_element!($ast, $($current)+),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; [$($elements:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_array_elements_array!(
      $ast;
      [$($elements,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_call_arguments_array {
  ($ast:expr; [$($arguments:expr,)*] ; [] ; ) => {
    [$($arguments,)*]
  };
  ($ast:expr; [$($arguments:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $($current)+)),]
  };
  ($ast:expr; [$($arguments:expr,)*] ; [] ; ,) => {
    [$($arguments,)*]
  };
  ($ast:expr; [$($arguments:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $($current)+)),]
  };
  ($ast:expr; [$($arguments:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_call_arguments_array!(
      $ast;
      [$($arguments,)* oxc_ast::ast::Argument::from($crate::quote_expr!($ast, $($current)+)),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; [$($arguments:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_call_arguments_array!(
      $ast;
      [$($arguments,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_properties_array {
  ($ast:expr; [$($properties:expr,)*] ; [] ; ) => {
    [$($properties,)*]
  };
  ($ast:expr; [$($properties:expr,)*] ; [$($current:tt)+] ; ) => {
    [$($properties,)* $crate::__quote_object_property!($ast, $($current)+),]
  };
  ($ast:expr; [$($properties:expr,)*] ; [] ; ,) => {
    [$($properties,)*]
  };
  ($ast:expr; [$($properties:expr,)*] ; [$($current:tt)+] ; ,) => {
    [$($properties,)* $crate::__quote_object_property!($ast, $($current)+),]
  };
  ($ast:expr; [$($properties:expr,)*] ; [$($current:tt)+] ; , $($rest:tt)*) => {
    $crate::__quote_object_properties_array!(
      $ast;
      [$($properties,)* $crate::__quote_object_property!($ast, $($current)+),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; [$($properties:expr,)*] ; [$($current:tt)*] ; $next:tt $($rest:tt)*) => {
    $crate::__quote_object_properties_array!(
      $ast;
      [$($properties,)*];
      [$($current)* $next];
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_arrow_parameters {
  ($ast:expr; [$($params:expr,)*] ; ) => {{
    let __ast = $ast;
    (__ast.vec_from_array([$($params,)*]), None)
  }};
  ($ast:expr; [$($params:expr,)*] ; ...{$rest:ident} $(,)?) => {{
    let __ast = $ast;
    (
      __ast.vec_from_array([$($params,)*]),
      Some($crate::quote::quote_binding_name(
        __ast,
        $crate::__quote_binding_name!(__ast, {$rest}),
      )),
    )
  }};
  ($ast:expr; [$($params:expr,)*] ; ...$rest:tt $(,)?) => {{
    let __ast = $ast;
    (
      __ast.vec_from_array([$($params,)*]),
      Some($crate::quote::quote_binding_name(
        __ast,
        $crate::__quote_binding_name!(__ast, $rest),
      )),
    )
  }};
  ($ast:expr; [$($params:expr,)*] ; $param:tt, $($rest:tt)*) => {{
    let __ast = $ast;
    $crate::__quote_arrow_parameters!(
      __ast;
      [$(
        $params,
      )* $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param)),];
      $($rest)*
    )
  }};
  ($ast:expr; [$($params:expr,)*] ; $param:tt $(,)?) => {{
    let __ast = $ast;
    (
      __ast.vec_from_array([
        $($params,)*
        $crate::quote::quote_binding_name(__ast, $crate::__quote_binding_name!(__ast, $param)),
      ]),
      None,
    )
  }};
}

#[doc(hidden)]
pub fn quote_static_member_expression<'a>(
  ast: AstBuilder<'a>,
  object: Expression<'a>,
  property: impl QuoteBindingName<'a>,
) -> Expression<'a> {
  Expression::from(ast.member_expression_static(
    SPAN,
    object,
    ast.identifier_name(SPAN, quote_binding_name(ast, property)),
    false,
  ))
}

#[doc(hidden)]
pub fn quote_computed_member_expression<'a>(
  ast: AstBuilder<'a>,
  object: Expression<'a>,
  property: Expression<'a>,
) -> Expression<'a> {
  Expression::from(ast.member_expression_computed(SPAN, object, property, false))
}

#[doc(hidden)]
pub fn quote_call_expression<'a>(
  ast: AstBuilder<'a>,
  callee: Expression<'a>,
  arguments: Vec<'a, Argument<'a>>,
) -> Expression<'a> {
  ast.expression_call(SPAN, callee, NONE, arguments, false)
}

#[doc(hidden)]
pub fn quote_arrow_function_expression<'a, I>(
  ast: AstBuilder<'a>,
  parameters: I,
  rest_parameter: Option<Atom<'a>>,
  body: Expression<'a>,
) -> Expression<'a>
where
  I: IntoIterator<Item = Atom<'a>>,
{
  ast.expression_arrow_function(
    SPAN,
    false,
    false,
    NONE,
    ast.formal_parameters(
      SPAN,
      FormalParameterKind::ArrowFormalParameters,
      ast.vec_from_iter(parameters.into_iter().map(|name| {
        ast.formal_parameter(
          SPAN,
          ast.vec(),
          ast.binding_pattern_binding_identifier(SPAN, name),
          NONE,
          NONE,
          false,
          None,
          false,
          false,
        )
      })),
      rest_parameter.map(|name| {
        ast.formal_parameter_rest(
          SPAN,
          ast.vec(),
          ast.binding_rest_element(SPAN, ast.binding_pattern_binding_identifier(SPAN, name)),
          NONE,
        )
      }),
    ),
    NONE,
    ast.function_body(
      SPAN,
      ast.vec(),
      ast.vec1(ast.statement_return(SPAN, Some(body))),
    ),
  )
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_atom {
  ($ast:expr, format!($format:literal)) => {{
    let __ast = $ast;
    let __value = oxc_span::format_atom!(__ast.allocator, $format);
    $crate::quote::quote_literal(__ast, __value)
  }};
  ($ast:expr, [$($items:tt)*]) => {{
    let __ast = $ast;
    __ast.expression_array(
      oxc_span::SPAN,
      __ast.vec_from_array($crate::__quote_array_elements_array!(__ast; []; []; $($items)*)),
    )
  }};
  ($ast:expr, {$ident:ident}) => {{
    let __ast = $ast;
    $crate::quote::quote_interpolation(__ast, $ident)
  }};
  ($ast:expr, {$($props:tt)*}) => {{
    let __ast = $ast;
    __ast.expression_object(
      oxc_span::SPAN,
      __ast.vec_from_array($crate::__quote_object_properties_array!(__ast; []; []; $($props)*)),
    )
  }};
  ($ast:expr, ($($value:tt)*)) => {{
    let __ast = $ast;
    __ast.expression_parenthesized(oxc_span::SPAN, $crate::quote_expr!(__ast, $($value)*))
  }};
  ($ast:expr, null) => {{
    let __ast = $ast;
    __ast.expression_null_literal(oxc_span::SPAN)
  }};
  ($ast:expr, undefined) => {{
    let __ast = $ast;
    __ast.expression_identifier(oxc_span::SPAN, "undefined")
  }};
  ($ast:expr, $literal:literal) => {{
    let __ast = $ast;
    $crate::quote::quote_literal(__ast, $literal)
  }};
  ($ast:expr, $ident:ident) => {{
    let __ast = $ast;
    __ast.expression_identifier(oxc_span::SPAN, stringify!($ident))
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_postfix {
  ($ast:expr, $expr:expr,) => {
    $expr
  };
  ($ast:expr, $expr:expr, . {$property:ident} $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::quote::quote_static_member_expression(__ast, $expr, $property);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, $expr:expr, . $property:ident $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr =
      $crate::quote::quote_static_member_expression(__ast, $expr, stringify!($property));
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, $expr:expr, [ $($property:tt)* ] $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::quote::quote_computed_member_expression(
      __ast,
      $expr,
      $crate::quote_expr!(__ast, $($property)*),
    );
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, $expr:expr, ( $($arguments:tt)* ) $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::quote::quote_call_expression(
      __ast,
      $expr,
      __ast.vec_from_array($crate::__quote_call_arguments_array!(__ast; []; []; $($arguments)*)),
    );
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_parse {
  ($ast:expr, ($($params:tt)*) => $($body:tt)+) => {{
    let __ast = $ast;
    let (__params, __rest) = $crate::__quote_arrow_parameters!(__ast; []; $($params)*);
    $crate::quote::quote_arrow_function_expression(
      __ast,
      __params,
      __rest,
      $crate::quote_expr!(__ast, $($body)+),
    )
  }};
  ($ast:expr, {$param:ident} => $($body:tt)+) => {{
    let __ast = $ast;
    $crate::quote::quote_arrow_function_expression(
      __ast,
      [oxc_span::Atom::from($crate::__quote_binding_name!(__ast, {$param}))],
      None,
      $crate::quote_expr!(__ast, $($body)+),
    )
  }};
  ($ast:expr, $param:tt => $($body:tt)+) => {{
    let __ast = $ast;
    $crate::quote::quote_arrow_function_expression(
      __ast,
      [oxc_span::Atom::from($crate::__quote_binding_name!(__ast, $param))],
      None,
      $crate::quote_expr!(__ast, $($body)+),
    )
  }};
  ($ast:expr, format!($format:literal) $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, format!($format));
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, [$($items:tt)*] $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, [$($items)*]);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, {$ident:ident} $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, {$ident});
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, {$($props:tt)*} $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, {$($props)*});
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, ($($value:tt)*) $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, ($($value)*));
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, null $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, null);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, undefined $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, undefined);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, $literal:literal $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, $literal);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
  ($ast:expr, $ident:ident $($rest:tt)*) => {{
    let __ast = $ast;
    let __expr = $crate::__quote_expr_atom!(__ast, $ident);
    $crate::__quote_expr_postfix!(__ast, __expr, $($rest)*)
  }};
}

#[macro_export]
macro_rules! quote_expr {
  ($ast:expr, $($value:tt)+) => {
    $crate::__quote_expr_parse!($ast, $($value)+)
  };
}

#[macro_export]
macro_rules! quote_stmt {
  ($ast:expr, import $local:tt from $source:tt;) => {{
    let __ast = $ast;
    $crate::quote::quote_import_default_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $local),
      $crate::__quote_module_source!(__ast, $source),
    )
  }};
  ($ast:expr, const $name:ident = ($($value:tt)+);) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::quote_expr!(__ast, $($value)+),
    )
  }};
  ($ast:expr, const $name:tt = format!($format:literal);) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, format!($format)),
    )
  }};
  ($ast:expr, const $name:tt = [$($value:tt)*];) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, [$($value)*]),
    )
  }};
  ($ast:expr, const $name:tt = {$ident:ident};) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, {$ident}),
    )
  }};
  ($ast:expr, const $name:tt = {$($value:tt)*};) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, {$($value)*}),
    )
  }};
  ($ast:expr, const $name:tt = null;) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, null),
    )
  }};
  ($ast:expr, const $name:tt = undefined;) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, undefined),
    )
  }};
  ($ast:expr, const $name:tt = $literal:literal;) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, $literal),
    )
  }};
  ($ast:expr, const $name:tt = $ident:ident;) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, $ident),
    )
  }};
  ($ast:expr, const $name:tt = $value:tt;) => {{
    let __ast = $ast;
    $crate::quote::quote_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::quote_expr!(__ast, $value),
    )
  }};
  ($ast:expr, export const $name:tt = ($($value:tt)+);) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::quote_expr!(__ast, $($value)+),
    )
  }};
  ($ast:expr, export const $name:tt = format!($format:literal);) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, format!($format)),
    )
  }};
  ($ast:expr, export const $name:tt = [$($value:tt)*];) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, [$($value)*]),
    )
  }};
  ($ast:expr, export const $name:tt = {$ident:ident};) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, {$ident}),
    )
  }};
  ($ast:expr, export const $name:tt = {$($value:tt)*};) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, {$($value)*}),
    )
  }};
  ($ast:expr, export const $name:tt = null;) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, null),
    )
  }};
  ($ast:expr, export const $name:tt = undefined;) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, undefined),
    )
  }};
  ($ast:expr, export const $name:tt = $literal:literal;) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, $literal),
    )
  }};
  ($ast:expr, export const $name:tt = $ident:ident;) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::__quote_expr_atom!(__ast, $ident),
    )
  }};
  ($ast:expr, export const $name:tt = $value:tt;) => {{
    let __ast = $ast;
    $crate::quote::quote_export_const_statement(
      __ast,
      $crate::__quote_binding_name!(__ast, $name),
      $crate::quote_expr!(__ast, $value),
    )
  }};
}

#[cfg(test)]
mod tests {
  use oxc_allocator::Allocator;
  use oxc_ast::{
    AstBuilder,
    ast::{ArrayExpressionElement, Expression, ObjectPropertyKind, PropertyKey, Statement},
  };
  use oxc_span::Atom;

  #[test]
  fn quote_builds_nested_literals_and_interpolations() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let value = ast.expression_identifier(oxc_span::SPAN, "value");
    let label: Atom = "label".into();
    let dynamic_key: Atom = "dynamicKey".into();
    let count = 3u32;
    let values = ast.vec_from_iter(
      [1u32, 2u32]
        .into_iter()
        .map(|value| ArrayExpressionElement::from(crate::quote::quote_literal(ast, value))),
    );

    let quoted = crate::quote_expr!(ast, {
      items: [1, "two", true, null, undefined, {value}, {label}, {count}],
      values: {values},
      nested: {
        answer: 42,
        "label": "ok",
        {dynamic_key}: "value",
        {dynamic_key},
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
    let value = ast.expression_identifier(oxc_span::SPAN, "value");
    let index = 3u32;

    let string = crate::quote_expr!(ast, "label");
    let formatted = crate::quote_expr!(ast, format!("css-{index}"));
    let number = crate::quote_expr!(ast, 42);
    let boolean = crate::quote_expr!(ast, true);
    let interpolated = crate::quote_expr!(ast, { value });

    assert!(matches!(string, Expression::StringLiteral(_)));
    let Expression::StringLiteral(formatted) = formatted else {
      panic!("expected formatted string literal");
    };
    assert_eq!(formatted.value.as_str(), "css-3");
    assert!(matches!(number, Expression::NumericLiteral(_)));
    assert!(matches!(boolean, Expression::BooleanLiteral(_)));
    assert!(matches!(interpolated, Expression::Identifier(_)));
  }

  #[test]
  fn quote_builds_postfix_expressions() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let call_value = ast.expression_identifier(oxc_span::SPAN, "value");
    let nested_value = ast.expression_identifier(oxc_span::SPAN, "value");
    let key: Atom = "key".into();
    let property: Atom = "primary".into();

    let member = crate::quote_expr!(ast, theme.colors.primary);
    let interpolated_member = crate::quote_expr!(ast, theme.colors.{property});
    let computed = crate::quote_expr!(ast, theme.colors[{ key }]);
    let call = crate::quote_expr!(ast, theme.colors.getPrimary({ call_value }, [1, theme.gap]));
    let nested = crate::quote_expr!(ast, {
      member: theme.colors.primary,
      interpolatedMember: theme.colors.{property},
      computed: theme.colors[{key}],
      call: theme.colors.getPrimary({nested_value}, [1, theme.gap]),
    });

    assert!(matches!(member, Expression::StaticMemberExpression(_)));
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
    let param: Atom = "value".into();
    let first: Atom = "first".into();
    let rest: Atom = "rest".into();

    let single = crate::quote_expr!(ast, value => value);
    let multi = crate::quote_expr!(ast, (first, second, ...rest) => first);
    let only_rest = crate::quote_expr!(ast, (...rest) => rest);
    let interpolated_single = crate::quote_expr!(ast, {param} => {param});
    let interpolated_multi = crate::quote_expr!(ast, ({first}, second, ...{rest}) => {first});

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
  }

  #[test]
  fn quote_builds_basic_statements() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let source: Atom = "./styles.css".into();
    let export_name: Atom = "dynamicStyles".into();
    let import_name: Atom = "dynamicImport".into();
    let value = ast.expression_identifier(oxc_span::SPAN, "value");
    let paren_value = ast.expression_identifier(oxc_span::SPAN, "value");
    let index = 3u32;

    let import = crate::quote_stmt!(ast, import styles from {source};);
    let interpolated_import = crate::quote_stmt!(ast, import {import_name} from {source};);
    let const_decl = crate::quote_stmt!(ast, const styles = {value};);
    let interpolated_const_decl = crate::quote_stmt!(ast, const {export_name} = "ok";);
    let paren_const_decl =
      crate::quote_stmt!(ast, const styles = (theme.colors.getPrimary({paren_value})););
    let array_const_decl = crate::quote_stmt!(ast, const styles = [1, "two"];);
    let export_decl = crate::quote_stmt!(ast, export const styles = "ok";);
    let interpolated_export_decl = crate::quote_stmt!(ast, export const {export_name} = "ok";);
    let paren_export_decl = crate::quote_stmt!(ast, export const styles = (theme.colors.primary););
    let format_export_decl = crate::quote_stmt!(ast, export const styles = format!("css-{index}"););

    assert!(matches!(import, Statement::ImportDeclaration(_)));
    assert!(matches!(
      interpolated_import,
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
      paren_export_decl,
      Statement::ExportNamedDeclaration(_)
    ));
    assert!(matches!(
      format_export_decl,
      Statement::ExportNamedDeclaration(_)
    ));
  }
}
