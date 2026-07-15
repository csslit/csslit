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
use oxc_syntax::{
  number::NumberBase,
  operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator},
};

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

impl<'a, T> QuoteInterpolation<'a> for T
where
  T: QuoteLiteral<'a>,
{
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    quote_literal(ast, span, self)
  }
}

impl<'a> QuoteInterpolation<'a> for Ident<'a> {
  fn into_quoted_interpolation(self, ast: &impl GetAstBuilder<'a>, span: Span) -> Expression<'a> {
    Expression::new_identifier(span, self, ast)
  }
}

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

/// An infix operator understood by the quote parser.
///
/// Keeping precedence here, instead of encoding every precedence level as a
/// recursive macro, is important. `macro_rules!` recursion limits are low and
/// a conventional recursive-descent parser would recurse through every unused
/// precedence level for every expression. The macros therefore collect a flat
/// operand/operator sequence and this small construction-time helper folds it.
#[doc(hidden)]
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub enum QuoteInfixOperator {
  Binary(BinaryOperator),
  Logical(LogicalOperator),
}

impl QuoteInfixOperator {
  fn precedence(self) -> u8 {
    match self {
      Self::Logical(LogicalOperator::Or | LogicalOperator::Coalesce) => 1,
      Self::Logical(LogicalOperator::And) => 2,
      Self::Binary(BinaryOperator::BitwiseOR) => 3,
      Self::Binary(BinaryOperator::BitwiseXOR) => 4,
      Self::Binary(BinaryOperator::BitwiseAnd) => 5,
      Self::Binary(
        BinaryOperator::Equality
        | BinaryOperator::Inequality
        | BinaryOperator::StrictEquality
        | BinaryOperator::StrictInequality,
      ) => 6,
      Self::Binary(
        BinaryOperator::LessThan
        | BinaryOperator::LessEqualThan
        | BinaryOperator::GreaterThan
        | BinaryOperator::GreaterEqualThan
        | BinaryOperator::In
        | BinaryOperator::Instanceof,
      ) => 7,
      Self::Binary(
        BinaryOperator::ShiftLeft | BinaryOperator::ShiftRight | BinaryOperator::ShiftRightZeroFill,
      ) => 8,
      Self::Binary(BinaryOperator::Addition | BinaryOperator::Subtraction) => 9,
      Self::Binary(
        BinaryOperator::Multiplication | BinaryOperator::Division | BinaryOperator::Remainder,
      ) => 10,
      Self::Binary(BinaryOperator::Exponential) => 11,
    }
  }

  fn is_right_associative(self) -> bool {
    matches!(self, Self::Binary(BinaryOperator::Exponential))
  }

  fn build<'a>(
    self,
    ast: &impl GetAstBuilder<'a>,
    span: Span,
    left: Expression<'a>,
    right: Expression<'a>,
  ) -> Expression<'a> {
    match self {
      Self::Binary(operator) => Expression::new_binary_expression(span, left, operator, right, ast),
      Self::Logical(operator) => {
        Expression::new_logical_expression(span, left, operator, right, ast)
      }
    }
  }
}

/// Fold the flat infix sequence emitted by `__quote_expr_after_operand!`.
///
/// The arrays are fixed-size and the helper is forced inline. In optimized
/// transformer builds LLVM can see every operator and removes the stack
/// bookkeeping, leaving the same builder calls handwritten code would make.
#[doc(hidden)]
#[inline(always)]
pub fn quote_infix_expression<'a, const N: usize, const M: usize>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  operands: [Expression<'a>; N],
  operators: [QuoteInfixOperator; M],
) -> Expression<'a> {
  assert!(N == M + 1);

  let mut values: [Option<Expression<'a>>; N] = std::array::from_fn(|_| None);
  let mut pending: [Option<QuoteInfixOperator>; M] = [None; M];
  let mut value_len = 0;
  let mut pending_len = 0;
  let mut operands = operands.into_iter();

  values[value_len] = operands.next();
  value_len += 1;

  for (operator, operand) in operators.into_iter().zip(operands) {
    while pending_len > 0 {
      let previous = pending[pending_len - 1].unwrap();
      if previous.precedence() < operator.precedence()
        || (previous.precedence() == operator.precedence() && operator.is_right_associative())
      {
        break;
      }

      pending_len -= 1;
      value_len -= 1;
      let right = values[value_len].take().unwrap();
      value_len -= 1;
      let left = values[value_len].take().unwrap();
      values[value_len] = Some(previous.build(ast, span, left, right));
      value_len += 1;
    }

    pending[pending_len] = Some(operator);
    pending_len += 1;
    values[value_len] = Some(operand);
    value_len += 1;
  }

  while pending_len > 0 {
    pending_len -= 1;
    value_len -= 1;
    let right = values[value_len].take().unwrap();
    value_len -= 1;
    let left = values[value_len].take().unwrap();
    values[value_len] = Some(pending[pending_len].unwrap().build(ast, span, left, right));
    value_len += 1;
  }

  values[0].take().unwrap()
}

#[doc(hidden)]
#[inline(always)]
pub fn quote_prefix_expression<'a, const N: usize>(
  ast: &impl GetAstBuilder<'a>,
  span: Span,
  expression: Expression<'a>,
  operators: [UnaryOperator; N],
) -> Expression<'a> {
  operators
    .into_iter()
    .rev()
    .fold(expression, |argument, operator| {
      Expression::new_unary_expression(span, operator, argument, ast)
    })
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

// ---------------------------------------------------------------------------
// Token categories and comma-separated lists
// ---------------------------------------------------------------------------
//
// `macro_rules!` can only inspect Rust token trees. Delimited JavaScript forms
// (`(...)`, `[...]`, `{...}`) are therefore ideal boundaries, while constructs
// that depend on whitespace, automatic semicolon insertion, backticks, or
// regex lexical context cannot be represented faithfully. Each macro below
// owns one syntactic category so adding support never requires a cross-product
// of every kind of name, source, expression, and statement.

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_binding_name {
  ($ast:expr, @{$value:expr}) => {
    $value
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
macro_rules! __quote_module_source {
  ($ast:expr, @{$value:expr}) => {
    $value
  };
  ($ast:expr, @$literal:literal) => {{
    let __ast = $ast;
    oxc_str::format_str!(oxc_allocator::GetAllocator::allocator(__ast), $literal)
  }};
  ($ast:expr, $literal:literal) => {
    $literal
  };
}

// List parsers all use the same pattern: collect tokens until a top-level
// comma, then let a category-specific macro turn that item into AST. Commas
// inside parentheses/brackets/braces are hidden inside a single token tree.
// To add another list category, copy only this small scanner and define the
// conversion performed by its `__quote_push_*` macro.

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_push_array_element {
  ($ast:expr, $span:ident, $elements:ident, @ { .. $values:expr }) => {
    for __value in $values {
      $elements.push(oxc_ast::ast::ArrayExpressionElement::from(
        $crate::quote::quote_interpolation($ast, $span, __value),
      ));
    }
  };
  ($ast:expr, $span:ident, $elements:ident, $($value:tt)+) => {
    $elements.push(oxc_ast::ast::ArrayExpressionElement::from(
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    ));
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_array_elements {
  ($ast:expr, $span:ident, $elements:ident; []; ) => {};
  ($ast:expr, $span:ident, $elements:ident; [$($item:tt)+]; ) => {
    $crate::__quote_push_array_element!($ast, $span, $elements, $($item)+);
  };
  ($ast:expr, $span:ident, $elements:ident; []; , $($rest:tt)*) => {
    compile_error!("sparse array elisions are not supported by quote_expr!");
  };
  ($ast:expr, $span:ident, $elements:ident; [$($item:tt)+]; , $($rest:tt)*) => {
    $crate::__quote_push_array_element!($ast, $span, $elements, $($item)+);
    $crate::__quote_array_elements!($ast, $span, $elements; []; $($rest)*);
  };
  ($ast:expr, $span:ident, $elements:ident; [$($item:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_array_elements!($ast, $span, $elements; [$($item)* $next]; $($rest)*);
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_push_call_argument {
  ($ast:expr, $span:ident, $arguments:ident, @ { .. $values:expr }) => {
    for __value in $values {
      $arguments.push(oxc_ast::ast::Argument::from(
        $crate::quote::quote_interpolation($ast, $span, __value),
      ));
    }
  };
  ($ast:expr, $span:ident, $arguments:ident, $($value:tt)+) => {
    $arguments.push(oxc_ast::ast::Argument::from(
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    ));
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_call_arguments {
  ($ast:expr, $span:ident, $arguments:ident; []; ) => {};
  ($ast:expr, $span:ident, $arguments:ident; [$($item:tt)+]; ) => {
    $crate::__quote_push_call_argument!($ast, $span, $arguments, $($item)+);
  };
  ($ast:expr, $span:ident, $arguments:ident; []; , $($rest:tt)*) => {
    compile_error!("expected a quoted call argument before `,`");
  };
  ($ast:expr, $span:ident, $arguments:ident; [$($item:tt)+]; , $($rest:tt)*) => {
    $crate::__quote_push_call_argument!($ast, $span, $arguments, $($item)+);
    $crate::__quote_call_arguments!($ast, $span, $arguments; []; $($rest)*);
  };
  ($ast:expr, $span:ident, $arguments:ident; [$($item:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_call_arguments!($ast, $span, $arguments; [$($item)* $next]; $($rest)*);
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_property {
  ($ast:expr, $span:ident, @{$key:expr}) => {
    $crate::quote::quote_object_property_shorthand($ast, $span, $key)
  };
  ($ast:expr, $span:ident, @{$key:expr} : $($value:tt)+) => {
    $crate::quote::quote_object_property_named(
      $ast,
      $span,
      $key,
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
  ($ast:expr, $span:ident, $key:ident) => {
    $crate::quote::quote_object_property_shorthand($ast, $span, stringify!($key))
  };
  ($ast:expr, $span:ident, $key:ident : $($value:tt)+) => {
    $crate::quote::quote_object_property_named(
      $ast,
      $span,
      stringify!($key),
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
  ($ast:expr, $span:ident, $key:literal : $($value:tt)+) => {
    oxc_ast::ast::ObjectPropertyKind::new_object_property(
      $span,
      oxc_ast::ast::PropertyKind::Init,
      oxc_ast::ast::PropertyKey::StringLiteral(oxc_ast::ast::StringLiteral::boxed(
        $span, $key, None, $ast,
      )),
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
      false,
      false,
      false,
      $ast,
    )
  };
  ($ast:expr, $span:ident, @$key:literal : $($value:tt)+) => {
    oxc_ast::ast::ObjectPropertyKind::new_object_property(
      $span,
      oxc_ast::ast::PropertyKind::Init,
      oxc_ast::ast::PropertyKey::StringLiteral(oxc_ast::ast::StringLiteral::boxed(
        $span,
        oxc_str::format_str!(oxc_allocator::GetAllocator::allocator($ast), $key),
        None,
        $ast,
      )),
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
      false,
      false,
      false,
      $ast,
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_push_object_property {
  ($ast:expr, $span:ident, $properties:ident, @ { .. $values:expr }) => {
    $properties.extend($values);
  };
  ($ast:expr, $span:ident, $properties:ident, $($property:tt)+) => {
    $properties.push($crate::__quote_object_property!($ast, $span, $($property)+));
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_object_properties {
  ($ast:expr, $span:ident, $properties:ident; []; ) => {};
  ($ast:expr, $span:ident, $properties:ident; [$($item:tt)+]; ) => {
    $crate::__quote_push_object_property!($ast, $span, $properties, $($item)+);
  };
  ($ast:expr, $span:ident, $properties:ident; []; , $($rest:tt)*) => {
    compile_error!("expected a quoted object property before `,`");
  };
  ($ast:expr, $span:ident, $properties:ident; [$($item:tt)+]; , $($rest:tt)*) => {
    $crate::__quote_push_object_property!($ast, $span, $properties, $($item)+);
    $crate::__quote_object_properties!($ast, $span, $properties; []; $($rest)*);
  };
  ($ast:expr, $span:ident, $properties:ident; [$($item:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_object_properties!($ast, $span, $properties; [$($item)* $next]; $($rest)*);
  };
}

// Arrow parameters are deliberately a separate category. They are binding
// names, not expressions, and the optional rest parameter belongs to the
// `FormalParameters` node rather than its ordinary item list.
#[doc(hidden)]
#[macro_export]
macro_rules! __quote_arrow_parameters {
  ($ast:expr; [$($params:expr,)*]; []; ) => {
    (oxc_allocator::ArenaVec::from_array_in([$($params,)*], $ast), None)
  };
  ($ast:expr; [$($params:expr,)*]; [... $($rest:tt)+]; ) => {
    (
      oxc_allocator::ArenaVec::from_array_in([$($params,)*], $ast),
      Some($crate::quote::quote_binding_name(
        $ast,
        $crate::__quote_binding_name!($ast, $($rest)+),
      )),
    )
  };
  ($ast:expr; [$($params:expr,)*]; [$($param:tt)+]; ) => {
    (
      oxc_allocator::ArenaVec::from_array_in([
        $($params,)*
        $crate::quote::quote_binding_name(
          $ast,
          $crate::__quote_binding_name!($ast, $($param)+),
        ),
      ], $ast),
      None,
    )
  };
  ($ast:expr; [$($params:expr,)*]; [$($param:tt)+]; , $($rest:tt)*) => {
    $crate::__quote_arrow_parameters!(
      $ast;
      [$($params,)* $crate::quote::quote_binding_name(
        $ast,
        $crate::__quote_binding_name!($ast, $($param)+),
      ),];
      [];
      $($rest)*
    )
  };
  ($ast:expr; [$($params:expr,)*]; [$($param:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_arrow_parameters!(
      $ast;
      [$($params,)*];
      [$($param)* $next];
      $($rest)*
    )
  };
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------
//
// Parsing is split into three extensible stages:
//
// 1. `__quote_expr_operand!` consumes prefix operators and one primary.
// 2. `__quote_expr_after_operand!` consumes postfix operations and recognizes
//    the next infix operator.
// 3. `quote_infix_expression` folds the flat result using JS precedence.
//
// A new primary or postfix form needs one arm in its stage. A new infix
// operator needs one enum mapping arm below and one precedence mapping in
// `QuoteInfixOperator`; it does not require another parser layer.

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_primary_done {
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; [$($prefix:expr,)*]; ($value:expr); $($rest:tt)*) => {{
    $crate::__quote_expr_after_operand!(
      $ast, $span;
      [$($operands,)*];
      [$($operators,)*];
      [$($prefix,)*];
      ($value);
      $($rest)*
    )
  }};
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_operand {
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; ! $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::LogicalNot,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; ~ $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::BitwiseNot,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; + $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::UnaryPlus,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; - $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::UnaryNegation,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; typeof $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::Typeof,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; void $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::Void,]; $($rest)+)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; delete $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; $operands; $operators; [$($prefix,)* oxc_syntax::operator::UnaryOperator::Delete,]; $($rest)+)
  };

  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; @$literal:literal $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      $crate::quote::quote_literal(
        $ast,
        $span,
        oxc_str::format_str!(oxc_allocator::GetAllocator::allocator($ast), $literal),
      )
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; @{$value:expr} $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      $crate::quote::quote_interpolation($ast, $span, $value)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; [$($items:tt)*] $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; ({
      let mut __elements = oxc_allocator::ArenaVec::new_in(oxc_ast::builder::GetAstBuilder::builder($ast));
      $crate::__quote_array_elements!($ast, $span, __elements; []; $($items)*);
      oxc_ast::ast::Expression::new_array_expression($span, __elements, $ast)
    }); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; {$($properties:tt)*} $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; ({
      let mut __properties = oxc_allocator::ArenaVec::new_in(oxc_ast::builder::GetAstBuilder::builder($ast));
      $crate::__quote_object_properties!($ast, $span, __properties; []; $($properties)*);
      oxc_ast::ast::Expression::new_object_expression($span, __properties, $ast)
    }); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; ($($value:tt)+) $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      $crate::__quote_expr_parse!($ast, $span, $($value)+)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; null $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      oxc_ast::ast::Expression::new_null_literal($span, $ast)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; undefined $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      oxc_ast::ast::Expression::new_identifier($span, "undefined", $ast)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; $literal:literal $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      $crate::quote::quote_literal($ast, $span, $literal)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; $prefix:tt; $ident:ident $($rest:tt)*) => {
    $crate::__quote_expr_primary_done!($ast, $span; [$($operands,)*]; [$($operators,)*]; $prefix; (
      oxc_ast::ast::Expression::new_identifier($span, stringify!($ident), $ast)
    ); $($rest)*)
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_after_operand {
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; $prefix:tt; ($value:expr); . @$property:literal $($rest:tt)*) => {
    $crate::__quote_expr_after_operand!($ast, $span; $operands; $operators; $prefix; (
      $crate::quote::quote_static_member_expression(
        $ast,
        $span,
        $value,
        oxc_str::format_ident!(oxc_allocator::GetAllocator::allocator($ast), $property),
      )
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; $prefix:tt; ($value:expr); . @{$property:expr} $($rest:tt)*) => {
    $crate::__quote_expr_after_operand!($ast, $span; $operands; $operators; $prefix; (
      $crate::quote::quote_static_member_expression($ast, $span, $value, $property)
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; $prefix:tt; ($value:expr); . $property:ident $($rest:tt)*) => {
    $crate::__quote_expr_after_operand!($ast, $span; $operands; $operators; $prefix; (
      $crate::quote::quote_static_member_expression($ast, $span, $value, stringify!($property))
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; $prefix:tt; ($value:expr); [$($property:tt)+] $($rest:tt)*) => {
    $crate::__quote_expr_after_operand!($ast, $span; $operands; $operators; $prefix; (
      $crate::quote::quote_computed_member_expression(
        $ast,
        $span,
        $value,
        $crate::__quote_expr_parse!($ast, $span, $($property)+),
      )
    ); $($rest)*)
  };
  ($ast:expr, $span:ident; $operands:tt; $operators:tt; $prefix:tt; ($value:expr); ($($arguments:tt)*) $($rest:tt)*) => {
    $crate::__quote_expr_after_operand!($ast, $span; $operands; $operators; $prefix; ({
      let mut __arguments = oxc_allocator::ArenaVec::new_in(oxc_ast::builder::GetAstBuilder::builder($ast));
      $crate::__quote_call_arguments!($ast, $span, __arguments; []; $($arguments)*);
      $crate::quote::quote_call_expression($ast, $span, $value, __arguments)
    }); $($rest)*)
  };

  ($ast:expr, $span:ident; $operands:tt; $operators:tt; [$($prefix:expr,)*]; ($value:expr); $($rest:tt)*) => {
    $crate::__quote_expr_infix!(
      $ast, $span;
      $operands;
      $operators;
      ($crate::quote::quote_prefix_expression($ast, $span, $value, [$($prefix,)*]));
      $($rest)*
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_infix {
  // Longest token sequences must appear first. Rust supplies punctuation as
  // individual tokens, so JavaScript's multi-character operators are matched
  // by their token sequence rather than as a single token.
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); == = $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::StrictEquality),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); != = $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::StrictInequality),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); >> > $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::ShiftRightZeroFill),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); == $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Equality),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); != $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Inequality),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); <= $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::LessEqualThan),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); >= $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::GreaterEqualThan),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); << $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::ShiftLeft),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); >> $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::ShiftRight),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); * * $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Exponential),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); || $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Logical(oxc_syntax::operator::LogicalOperator::Or),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); && $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Logical(oxc_syntax::operator::LogicalOperator::And),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); ? ? $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Logical(oxc_syntax::operator::LogicalOperator::Coalesce),]; []; $($rest)+)
  };

  // Single-token infix operators. Keep this list adjacent to the multi-token
  // list so extending precedence support remains a mechanical change.
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); + $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Addition),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); - $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Subtraction),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); * $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Multiplication),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); / $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Division),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); % $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Remainder),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); < $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::LessThan),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); > $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::GreaterThan),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); | $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::BitwiseOR),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); ^ $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::BitwiseXOR),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); & $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::BitwiseAnd),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); in $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::In),]; []; $($rest)+)
  };
  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); instanceof $($rest:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; [$($operands,)* $value,]; [$($operators,)* $crate::quote::QuoteInfixOperator::Binary(oxc_syntax::operator::BinaryOperator::Instanceof),]; []; $($rest)+)
  };

  ($ast:expr, $span:ident; [$($operands:expr,)*]; [$($operators:expr,)*]; ($value:expr); ) => {
    $crate::quote::quote_infix_expression(
      $ast,
      $span,
      [$($operands,)* $value],
      [$($operators,)*],
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_expr_parse {
  ($ast:expr, $span:ident, @{$target:expr} = $($value:tt)+) => {
    $crate::quote::quote_assignment_expression(
      $ast,
      $span,
      $target,
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
  ($ast:expr, $span:ident, ($($params:tt)*) => {$($body:tt)*}) => {{
    let (__params, __rest) = $crate::__quote_arrow_parameters!($ast; []; []; $($params)*);
    let mut __body = oxc_allocator::ArenaVec::new_in(oxc_ast::builder::GetAstBuilder::builder($ast));
    $crate::__quote_statement_list!($ast, $span, __body; []; $($body)*);
    $crate::quote::quote_arrow_function_block_expression(
      $ast, $span, __params, __rest, __body,
    )
  }};
  ($ast:expr, $span:ident, ($($params:tt)*) => $($body:tt)+) => {{
    let (__params, __rest) = $crate::__quote_arrow_parameters!($ast; []; []; $($params)*);
    $crate::quote::quote_arrow_function_expression(
      $ast,
      $span,
      __params,
      __rest,
      $crate::__quote_expr_parse!($ast, $span, $($body)+),
    )
  }};
  ($ast:expr, $span:ident, @{$param:expr} => {$($body:tt)*}) => {
    $crate::__quote_expr_parse!($ast, $span, (@{$param}) => {$($body)*})
  };
  ($ast:expr, $span:ident, @{$param:expr} => $($body:tt)+) => {
    $crate::__quote_expr_parse!($ast, $span, (@{$param}) => $($body)+)
  };
  ($ast:expr, $span:ident, $param:ident => {$($body:tt)*}) => {
    $crate::__quote_expr_parse!($ast, $span, ($param) => {$($body)*})
  };
  ($ast:expr, $span:ident, $param:ident => $($body:tt)+) => {
    $crate::__quote_expr_parse!($ast, $span, ($param) => $($body)+)
  };
  ($ast:expr, $span:ident, $($value:tt)+) => {
    $crate::__quote_expr_operand!($ast, $span; []; []; []; $($value)+)
  };
}

/// Construct an Oxc JavaScript expression AST using JavaScript-like syntax.
///
/// Supported syntax currently includes:
///
/// - string, number, and boolean literals; identifiers; `null`; `undefined`;
/// - arrays and object literals with comma-separated items and trailing commas;
/// - object shorthand plus identifier, string, formatted, or interpolated keys;
/// - grouping parentheses, static/computed members, and calls;
/// - arrow functions with identifier parameters and an optional rest parameter;
/// - `!`, `~`, unary `+`/`-`, `typeof`, `void`, and `delete`;
/// - arithmetic, shift, relational, equality, bitwise, and logical infix
///   operators with JavaScript precedence and associativity;
/// - assignment when its target is interpolated (`@{target} = value`).
///
/// Quote extensions:
///
/// - `@{value}` interpolates one Rust value in the current syntax category.
///   Expressions accept [`QuoteInterpolation`]; names and module sources use
///   their corresponding conversion traits.
/// - `@{..values}` splices an iterator into arrays, call arguments, object
///   properties, or statement lists.
/// - `@"name-{value}"` formats a string literal or name directly in the arena.
/// - `quote_expr!(ast, span, ...)` applies `span` to constructed nodes; omitting
///   it uses `oxc_span::SPAN`.
///
/// This is intentionally JavaScript-only. Rust cannot tokenize JavaScript
/// backticks, single-quoted strings, or whitespace-sensitive token boundaries,
/// so template literals, regex literals, sparse-array elisions, ASI, and
/// postfix `++`/`--` are not accepted. TypeScript syntax is out of scope.
/// Interpolate an already-built Oxc node for unsupported JavaScript syntax.
/// Parentheses group the quoted syntax but do not create Oxc
/// `ParenthesizedExpression` nodes. They are also the general escape hatch when
/// macro token boundaries would otherwise be ambiguous; the nested AST retains
/// the grouping and Oxc codegen emits any parentheses the output requires.
#[macro_export]
macro_rules! quote_expr {
  ($owner:expr, $span:ident, $($value:tt)+) => {{
    let __quote_ast = {
      #[allow(unused_imports)]
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($owner).builder())
    };
    let __ast = &__quote_ast;
    $crate::__quote_expr_parse!(__ast, $span, $($value)+)
  }};
  ($owner:expr, $($value:tt)+) => {{
    let __quote_ast = {
      #[allow(unused_imports)]
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($owner).builder())
    };
    let __ast = &__quote_ast;
    const __QUOTE_SPAN: oxc_span::Span = oxc_span::SPAN;
    $crate::__quote_expr_parse!(__ast, __QUOTE_SPAN, $($value)+)
  }};
}

// ---------------------------------------------------------------------------
// Statement parser
// ---------------------------------------------------------------------------
//
// Statement lists split on explicit top-level semicolons. This intentionally
// avoids pretending to implement JavaScript ASI. Compound statements without a
// semicolon will need a leading-keyword arm here when they are added.

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_push_statement {
  ($ast:expr, $span:ident, $statements:ident, @ { .. $values:expr }) => {
    $statements.extend($values);
  };
  ($ast:expr, $span:ident, $statements:ident, $($statement:tt)+) => {
    $statements.push($crate::__quote_stmt_parse!($ast, $span, $($statement)+));
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_statement_list {
  ($ast:expr, $span:ident, $statements:ident; []; ) => {};
  ($ast:expr, $span:ident, $statements:ident; [$($statement:tt)+]; ) => {
    $crate::__quote_push_statement!($ast, $span, $statements, $($statement)+);
  };
  ($ast:expr, $span:ident, $statements:ident; []; ; $($rest:tt)*) => {
    $crate::__quote_statement_list!($ast, $span, $statements; []; $($rest)*);
  };
  ($ast:expr, $span:ident, $statements:ident; [$($statement:tt)+]; ; $($rest:tt)*) => {
    $crate::__quote_push_statement!($ast, $span, $statements, $($statement)+);
    $crate::__quote_statement_list!($ast, $span, $statements; []; $($rest)*);
  };
  ($ast:expr, $span:ident, $statements:ident; [$($statement:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_statement_list!($ast, $span, $statements; [$($statement)* $next]; $($rest)*);
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_import_default {
  ($ast:expr, $span:ident, @$local:literal, $($source:tt)+) => {
    $crate::quote::quote_import_default_statement(
      $ast, $span,
      $crate::__quote_binding_name!($ast, @$local),
      $crate::__quote_module_source!($ast, $($source)+),
    )
  };
  ($ast:expr, $span:ident, @{$local:expr}, $($source:tt)+) => {
    $crate::quote::quote_import_default_statement(
      $ast, $span, $local, $crate::__quote_module_source!($ast, $($source)+),
    )
  };
  ($ast:expr, $span:ident, $local:ident, $($source:tt)+) => {
    $crate::quote::quote_import_default_statement(
      $ast, $span, stringify!($local), $crate::__quote_module_source!($ast, $($source)+),
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_import_namespace {
  ($ast:expr, $span:ident, @$local:literal, $($source:tt)+) => {
    $crate::quote::quote_import_namespace_statement(
      $ast, $span,
      $crate::__quote_binding_name!($ast, @$local),
      $crate::__quote_module_source!($ast, $($source)+),
    )
  };
  ($ast:expr, $span:ident, @{$local:expr}, $($source:tt)+) => {
    $crate::quote::quote_import_namespace_statement(
      $ast, $span, $local, $crate::__quote_module_source!($ast, $($source)+),
    )
  };
  ($ast:expr, $span:ident, $local:ident, $($source:tt)+) => {
    $crate::quote::quote_import_namespace_statement(
      $ast, $span, stringify!($local), $crate::__quote_module_source!($ast, $($source)+),
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_declaration {
  ($ast:expr, $span:ident, $builder:path, @$name:literal, $($value:tt)+) => {
    $builder(
      $ast, $span,
      $crate::__quote_binding_name!($ast, @$name),
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
  ($ast:expr, $span:ident, $builder:path, @{$name:expr}, $($value:tt)+) => {
    $builder($ast, $span, $name, $crate::__quote_expr_parse!($ast, $span, $($value)+))
  };
  ($ast:expr, $span:ident, $builder:path, $name:ident, $($value:tt)+) => {
    $builder(
      $ast, $span, stringify!($name),
      $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_stmt_parse {
  ($ast:expr, $span:ident, @{$statement:expr}) => { $statement };
  ($ast:expr, $span:ident, {$($body:tt)*}) => {{
    let mut __body = oxc_allocator::ArenaVec::new_in(oxc_ast::builder::GetAstBuilder::builder($ast));
    $crate::__quote_statement_list!($ast, $span, __body; []; $($body)*);
    $crate::quote::quote_block_statement($ast, $span, __body)
  }};
  ($ast:expr, $span:ident, import * as @$local:literal from $($source:tt)+) => {
    $crate::__quote_import_namespace!($ast, $span, @$local, $($source)+)
  };
  ($ast:expr, $span:ident, import * as @{$local:expr} from $($source:tt)+) => {
    $crate::__quote_import_namespace!($ast, $span, @{$local}, $($source)+)
  };
  ($ast:expr, $span:ident, import * as $local:ident from $($source:tt)+) => {
    $crate::__quote_import_namespace!($ast, $span, $local, $($source)+)
  };
  ($ast:expr, $span:ident, import @$local:literal from $($source:tt)+) => {
    $crate::__quote_import_default!($ast, $span, @$local, $($source)+)
  };
  ($ast:expr, $span:ident, import @{$local:expr} from $($source:tt)+) => {
    $crate::__quote_import_default!($ast, $span, @{$local}, $($source)+)
  };
  ($ast:expr, $span:ident, import $local:ident from $($source:tt)+) => {
    $crate::__quote_import_default!($ast, $span, $local, $($source)+)
  };
  ($ast:expr, $span:ident, import $($source:tt)+) => {
    $crate::quote::quote_import_statement(
      $ast, $span, $crate::__quote_module_source!($ast, $($source)+),
    )
  };
  ($ast:expr, $span:ident, export const @$name:literal = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_export_const_statement, @$name, $($value)+)
  };
  ($ast:expr, $span:ident, export const @{$name:expr} = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_export_const_statement, @{$name}, $($value)+)
  };
  ($ast:expr, $span:ident, export const $name:ident = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_export_const_statement, $name, $($value)+)
  };
  ($ast:expr, $span:ident, const @$name:literal = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_const_statement, @$name, $($value)+)
  };
  ($ast:expr, $span:ident, const @{$name:expr} = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_const_statement, @{$name}, $($value)+)
  };
  ($ast:expr, $span:ident, const $name:ident = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_const_statement, $name, $($value)+)
  };
  ($ast:expr, $span:ident, var @$name:literal = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_var_statement, @$name, $($value)+)
  };
  ($ast:expr, $span:ident, var @{$name:expr} = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_var_statement, @{$name}, $($value)+)
  };
  ($ast:expr, $span:ident, var $name:ident = $($value:tt)+) => {
    $crate::__quote_declaration!($ast, $span, $crate::quote::quote_var_statement, $name, $($value)+)
  };
  ($ast:expr, $span:ident, return) => {
    $crate::quote::quote_return_statement($ast, $span, None)
  };
  ($ast:expr, $span:ident, return $($value:tt)+) => {
    $crate::quote::quote_return_statement(
      $ast, $span, Some($crate::__quote_expr_parse!($ast, $span, $($value)+)),
    )
  };
  ($ast:expr, $span:ident, $($value:tt)+) => {
    $crate::quote::quote_expression_statement(
      $ast, $span, $crate::__quote_expr_parse!($ast, $span, $($value)+),
    )
  };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __quote_one_statement {
  ($ast:expr, $span:ident; [$($statement:tt)+]; ) => {
    $crate::__quote_stmt_parse!($ast, $span, $($statement)+)
  };
  ($ast:expr, $span:ident; [$($statement:tt)+]; ;) => {
    $crate::__quote_stmt_parse!($ast, $span, $($statement)+)
  };
  ($ast:expr, $span:ident; [$($statement:tt)*]; ; $($rest:tt)+) => {
    compile_error!("quote_stmt! accepts exactly one statement")
  };
  ($ast:expr, $span:ident; [$($statement:tt)*]; $next:tt $($rest:tt)*) => {
    $crate::__quote_one_statement!($ast, $span; [$($statement)* $next]; $($rest)*)
  };
}

/// Construct one Oxc JavaScript statement AST using JavaScript-like syntax.
///
/// Supported statements are expression statements, blocks, `return`, `const`,
/// `var`, `export const`, side-effect/default/namespace imports, and direct
/// statement interpolation. Initializers and return values accept all syntax
/// supported by [`quote_expr!`]. Simple statements use explicit semicolons;
/// JavaScript automatic semicolon insertion is deliberately not emulated.
///
/// Inside blocks and arrow-function bodies, `@{..statements}` splices an
/// iterator of statements. `@{statement}` interpolates one statement. Names,
/// sources, formatted text, and custom spans use the same extensions documented
/// on [`quote_expr!`]. Add new statement families as a dispatch arm in
/// `__quote_stmt_parse!`; add compound statements to the statement-list scanner
/// when they need to omit a trailing semicolon.
#[macro_export]
macro_rules! quote_stmt {
  ($owner:expr, $span:ident, $($statement:tt)+) => {{
    let __quote_ast = {
      #[allow(unused_imports)]
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($owner).builder())
    };
    let __ast = &__quote_ast;
    $crate::__quote_one_statement!(__ast, $span; []; $($statement)+)
  }};
  ($owner:expr, $($statement:tt)+) => {{
    let __quote_ast = {
      #[allow(unused_imports)]
      use oxc_ast::builder::GetAstBuilder as _;
      $crate::quote::QuoteAstBuilder::new(($owner).builder())
    };
    let __ast = &__quote_ast;
    const __QUOTE_SPAN: oxc_span::Span = oxc_span::SPAN;
    $crate::__quote_one_statement!(__ast, __QUOTE_SPAN; []; $($statement)+)
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
  use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

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
    let block = crate::quote_expr!(ast, () => { @{..block_body} });

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
    let call_value = Expression::new_identifier(oxc_span::SPAN, "value", &ast);
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
    let const_decl = crate::quote_stmt!(ast, const styles = @{value};);
    let interpolated_const_decl = crate::quote_stmt!(ast, const @{export_name} = "ok";);
    let call_const_decl =
      crate::quote_stmt!(ast, const styles = theme.colors.getPrimary(@{call_value}););
    let array_const_decl = crate::quote_stmt!(ast, const styles = [1, "two"];);
    let export_decl = crate::quote_stmt!(ast, export const styles = "ok";);
    let interpolated_export_decl = crate::quote_stmt!(ast, export const @{export_name} = "ok";);
    let formatted_export_decl = crate::quote_stmt!(ast, export const @"styles_{index}" = "ok";);
    let member_export_decl = crate::quote_stmt!(ast, export const styles = theme.colors.primary;);
    let return_stmt = crate::quote_stmt!(ast, return @{return_value};);
    let empty_return_stmt = crate::quote_stmt!(ast, return;);
    let expression_stmt = crate::quote_stmt!(ast, (@{statement_value}););
    let block_stmt = crate::quote_stmt!(ast, { @{..block_body} });
    let single_array_splice = crate::quote_expr!(ast, [@{..single_array_values}]);
    let array_splice = crate::quote_expr!(ast, [@{..lines}]);

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
    assert!(matches!(call_const_decl, Statement::VariableDeclaration(_)));
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
      member_export_decl,
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
  fn quote_parses_operators_and_explicit_splices() {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let values = [
      Expression::new_identifier(SPAN, "second", &ast),
      Expression::new_identifier(SPAN, "third", &ast),
    ];
    let arguments = [
      Expression::new_identifier(SPAN, "middle", &ast),
      Expression::new_identifier(SPAN, "last", &ast),
    ];

    let precedence = crate::quote_expr!(ast, first + second * third);
    let Expression::BinaryExpression(addition) = precedence else {
      panic!("expected addition");
    };
    assert_eq!(addition.operator, BinaryOperator::Addition);
    let Expression::BinaryExpression(multiplication) = &addition.right else {
      panic!("expected multiplication on the right");
    };
    assert_eq!(multiplication.operator, BinaryOperator::Multiplication);

    let grouped = crate::quote_expr!(ast, first * (second + third));
    let Expression::BinaryExpression(multiplication) = grouped else {
      panic!("expected multiplication");
    };
    assert_eq!(multiplication.operator, BinaryOperator::Multiplication);
    let Expression::BinaryExpression(addition) = &multiplication.right else {
      panic!("expected grouped addition without a parenthesis node");
    };
    assert_eq!(addition.operator, BinaryOperator::Addition);

    let associativity = crate::quote_expr!(ast, first * *second * *third);
    let Expression::BinaryExpression(outer_power) = associativity else {
      panic!("expected exponentiation");
    };
    assert_eq!(outer_power.operator, BinaryOperator::Exponential);
    let Expression::BinaryExpression(inner_power) = &outer_power.right else {
      panic!("expected right-associative exponentiation");
    };
    assert_eq!(inner_power.operator, BinaryOperator::Exponential);

    let unary = crate::quote_expr!(ast, !theme.enabled);
    let Expression::UnaryExpression(unary) = unary else {
      panic!("expected unary expression");
    };
    assert_eq!(unary.operator, UnaryOperator::LogicalNot);
    assert!(matches!(
      unary.argument,
      Expression::StaticMemberExpression(_)
    ));

    let array = crate::quote_expr!(ast, [first, @{..values}, fourth]);
    let Expression::ArrayExpression(array) = array else {
      panic!("expected array expression");
    };
    assert_eq!(array.elements.len(), 4);

    let call = crate::quote_expr!(ast, run(first, @{..arguments}));
    let Expression::CallExpression(call) = call else {
      panic!("expected call expression");
    };
    assert_eq!(call.arguments.len(), 3);

    assert!(matches!(
      crate::quote_stmt!(ast, const result = first + second * third;),
      Statement::VariableDeclaration(_)
    ));
    assert!(matches!(
      crate::quote_stmt!(ast, return first || second;),
      Statement::ReturnStatement(_)
    ));

    // Macro definitions are token matchers, so keep one expansion of every
    // supported spelling here. This catches both Rust tokenization surprises
    // and stale Oxc enum variant names when either dependency evolves.
    let _ = crate::quote_expr!(ast, first ?? second);
    let _ = crate::quote_expr!(ast, first && second);
    let _ = crate::quote_expr!(ast, first | second);
    let _ = crate::quote_expr!(ast, first ^ second);
    let _ = crate::quote_expr!(ast, first & second);
    let _ = crate::quote_expr!(ast, first == second);
    let _ = crate::quote_expr!(ast, first != second);
    let _ = crate::quote_expr!(ast, first === second);
    let _ = crate::quote_expr!(ast, first !== second);
    let _ = crate::quote_expr!(ast, first < second);
    let _ = crate::quote_expr!(ast, first <= second);
    let _ = crate::quote_expr!(ast, first > second);
    let _ = crate::quote_expr!(ast, first >= second);
    let _ = crate::quote_expr!(ast, first in second);
    let _ = crate::quote_expr!(ast, first instanceof second);
    let _ = crate::quote_expr!(ast, first << second);
    let _ = crate::quote_expr!(ast, first >> second);
    let _ = crate::quote_expr!(ast, first >>> second);
    let _ = crate::quote_expr!(ast, first - second);
    let _ = crate::quote_expr!(ast, first / second);
    let _ = crate::quote_expr!(ast, first % second);
    let _ = crate::quote_expr!(ast, ~first);
    let _ = crate::quote_expr!(ast, +first);
    let _ = crate::quote_expr!(ast, -first);
    let _ = crate::quote_expr!(ast, typeof first);
    let _ = crate::quote_expr!(ast, void first);
    let _ = crate::quote_expr!(ast, delete first.member);
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
