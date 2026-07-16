use crate::{CompileCsslitRequest, CompileCsslitResult, CsslitEvalBlock};
use cssparser::{Parser, ParserInput};
use lightningcss::{
  css_modules::Config,
  declaration::DeclarationBlock,
  rules::{CssRule, CssRuleList, Location, style::StyleRule},
  selector::{Component, PseudoClass, Selector},
  stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
  values::ident::Ident,
  vendor_prefix::VendorPrefix,
  visitor::{Visit, VisitTypes, Visitor},
};
use oxc_sourcemap::{SourceMap, SourceMapBuilder};
use parcel_selectors::parser::NthOfSelectorData;
use parcel_sourcemap::SourceMap as ParcelSourceMap;
use std::{
  convert::Infallible,
  mem::{replace, take},
};

const CSSLIT_CLASS_PREFIX: &str = "__csslit_class_";

struct CompiledBlock<'a> {
  code: String,
  map: Option<SourceMap<'a>>,
}

#[derive(Debug, PartialEq, Eq)]
struct MappingRun {
  start_byte: usize,
  end_byte: usize,
  start_line: u32,
  source_line: u32,
  source_column: u32,
  constant: bool,
}

pub(crate) fn compile_csslit(
  options: CompileCsslitRequest,
) -> Result<CompileCsslitResult, Box<dyn std::error::Error>> {
  let mut code = String::new();
  let mut map = options.sourcemap.then(|| {
    let mut builder = SourceMapBuilder::default();
    builder.set_source_and_content(&options.filename, "");
    builder
  });
  let mut line_offset = 0;

  for (index, block) in options.blocks.into_iter().enumerate() {
    let compiled = match block {
      CsslitEvalBlock::Scoped {
        scoped_name,
        code,
        mapping_runs,
      } => compile_scoped_block(
        &options.filename,
        index,
        &scoped_name,
        &code,
        mapping_runs.as_deref(),
        options.sourcemap,
      )?,
      CsslitEvalBlock::Global { code, mapping_runs } => compile_global_block(
        &options.filename,
        index,
        &code,
        mapping_runs.as_deref(),
        options.sourcemap,
      )?,
    };

    if index > 0 {
      code.push('\n');
      line_offset += 1;
    }

    let block_line_offset = line_offset;
    let block_code = compiled.code.trim_end();
    code.push_str(block_code);
    code.push('\n');
    line_offset += block_code.bytes().filter(|&byte| byte == b'\n').count() as u32 + 1;

    if let (Some(builder), Some(block_map)) = (&mut map, compiled.map) {
      for token in block_map.get_tokens() {
        builder.add_token(
          token.get_dst_line() + block_line_offset,
          token.get_dst_col(),
          token.get_src_line(),
          token.get_src_col(),
          token.get_source_id().map(|_| 0),
          None,
        );
      }
    }
  }

  code.truncate(code.trim_end().len());
  if !code.is_empty() {
    code.push('\n');
  }

  let mut map = map.map(SourceMapBuilder::into_sourcemap);
  if let Some(map) = &mut map {
    map.set_file(&format!("{}.csslit.css", options.filename));
  }

  Ok(CompileCsslitResult {
    code,
    map: map.map(Into::into),
  })
}

fn compile_scoped_block<'a>(
  filename: &'a str,
  index: usize,
  scoped_name: &str,
  code: &str,
  mapping_runs: Option<&[u32]>,
  sourcemap: bool,
) -> Result<CompiledBlock<'a>, Box<dyn std::error::Error>> {
  let block_filename = format!("{filename}?csslit-block={index}");
  let options: ParserOptions<'_, '_> = ParserOptions {
    filename: block_filename.clone(),
    css_modules: Some(Config::default()),
    ..ParserOptions::default()
  };

  let mut input = ParserInput::new(code);
  let mut parser = Parser::new(&mut input);
  // TODO: map parser errors back to the source template.
  let rules =
    CssRuleList::parse_style_block(&mut parser, &options, false).map_err(|err| err.to_string())?;

  let mut stylesheet = StyleSheet::new(vec![block_filename.clone()], rules, options);
  stylesheet.visit(&mut ClassReferenceRewriter { scoped: true })?;
  stylesheet.visit(&mut RuleScoper { scoped_name })?;

  let mut sparse_map = sourcemap.then(|| ParcelSourceMap::new("/"));

  let result = stylesheet
    .to_css(PrinterOptions {
      source_map: sparse_map.as_mut(),
      ..PrinterOptions::default()
    })
    .map_err(|err| err.to_string())?;

  let map = sparse_map
    .as_ref()
    .map(|sparse_map| compose_sparse_map(filename, code, &result.code, mapping_runs, sparse_map));

  Ok(CompiledBlock {
    code: result.code,
    map,
  })
}

fn compile_global_block<'a>(
  filename: &'a str,
  index: usize,
  code: &str,
  mapping_runs: Option<&[u32]>,
  sourcemap: bool,
) -> Result<CompiledBlock<'a>, Box<dyn std::error::Error>> {
  let block_filename = format!("{filename}?csslit-block={index}");
  let options = ParserOptions {
    filename: block_filename.clone(),
    ..ParserOptions::default()
  };

  let mut input = ParserInput::new(code);
  let mut parser = Parser::new(&mut input);
  // TODO: map parser errors back to the source template.
  let mut stylesheet = StyleSheet::new(
    vec![block_filename],
    CssRuleList::parse(&mut parser, &options).map_err(|err| err.to_string())?,
    options,
  );

  stylesheet.visit(&mut ClassReferenceRewriter { scoped: false })?;
  let mut sparse_map = sourcemap.then(|| ParcelSourceMap::new("/"));
  let result = stylesheet
    .to_css(PrinterOptions {
      source_map: sparse_map.as_mut(),
      ..PrinterOptions::default()
    })
    .map_err(|err| err.to_string())?;

  let map = sparse_map
    .as_ref()
    .map(|sparse_map| compose_sparse_map(filename, code, &result.code, mapping_runs, sparse_map));
  Ok(CompiledBlock {
    code: result.code,
    map,
  })
}

struct RuleScoper<'a> {
  scoped_name: &'a str,
}

impl<'i> Visitor<'i> for RuleScoper<'_> {
  type Error = Infallible;

  fn visit_types(&self) -> VisitTypes {
    VisitTypes::RULES
  }

  fn visit_rule_list(&mut self, rules: &mut CssRuleList<'i>) -> Result<(), Self::Error> {
    let list_len = rules.0.len();
    let mut rest = rules.0.as_mut_slice();

    while !rest.is_empty() {
      let scoped;
      (scoped, rest) = rest.split_at_mut(rest.partition_point(|r| match r {
        CssRule::Style(_) | CssRule::Nesting(_) | CssRule::NestedDeclarations(_) => true,
        _ => false,
      }));

      if scoped.is_empty() {
        rest[0].visit(self)?;
        rest = &mut rest[1..];
        continue;
      }

      if scoped.len() == list_len {
        rules.0 = vec![wrapper_rule(
          CssRuleList(take(&mut rules.0)),
          self.scoped_name,
        )];

        return Ok(());
      }

      scoped[0] = wrapper_rule(
        CssRuleList(
          scoped
            .iter_mut()
            .map(|rule| replace(rule, CssRule::Ignored))
            .collect(),
        ),
        self.scoped_name,
      );
    }

    Ok(())
  }

  fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Self::Error> {
    match rule {
      CssRule::Media(_)
      | CssRule::Supports(_)
      | CssRule::Container(_)
      | CssRule::LayerBlock(_)
      | CssRule::Scope(_)
      | CssRule::StartingStyle(_)
      | CssRule::MozDocument(_) => rule.visit_children(self)?,
      _ => {}
    }
    Ok(())
  }
}

struct ClassReferenceRewriter {
  scoped: bool,
}

impl<'i> Visitor<'i> for ClassReferenceRewriter {
  type Error = Infallible;

  fn visit_types(&self) -> VisitTypes {
    VisitTypes::SELECTORS
  }

  fn visit_selector(&mut self, selector: &mut Selector<'i>) -> Result<(), Self::Error> {
    rewrite_selector(selector, self.scoped);
    return Ok(());

    fn rewrite_selector(selector: &mut Selector, scoped: bool) {
      for component in selector.iter_mut_raw_match_order() {
        match component {
          Component::Class(class) => {
            if let Some(reference) = class.0.strip_prefix(CSSLIT_CLASS_PREFIX) {
              let class = Component::Class(Ident(reference.to_owned().into()));

              *component = if scoped {
                Component::NonTSPseudoClass(PseudoClass::Global {
                  selector: Box::new(Selector::from(class)),
                })
              } else {
                class
              };
            }
          }
          Component::Negation(selectors)
          | Component::Where(selectors)
          | Component::Is(selectors)
          | Component::Any(_, selectors)
          | Component::Has(selectors) => {
            for selector in selectors.iter_mut() {
              rewrite_selector(selector, scoped);
            }
          }
          Component::NthOf(data) => {
            let nth_data = *data.nth_data();
            let mut selectors = data.clone_selectors();
            for selector in &mut selectors {
              rewrite_selector(selector, scoped);
            }
            *component = Component::NthOf(NthOfSelectorData::new(nth_data, selectors));
          }
          Component::Slotted(selector) => rewrite_selector(selector, scoped),
          Component::Host(selector) => {
            if let Some(selector) = selector {
              rewrite_selector(selector, scoped);
            }
          }
          Component::NonTSPseudoClass(PseudoClass::Local { selector })
          | Component::NonTSPseudoClass(PseudoClass::Global { selector }) => {
            rewrite_selector(selector, scoped);
          }
          Component::Combinator(_)
          | Component::ExplicitAnyNamespace
          | Component::ExplicitNoNamespace
          | Component::DefaultNamespace(_)
          | Component::Namespace(_, _)
          | Component::ExplicitUniversalType
          | Component::LocalName(_)
          | Component::ID(_)
          | Component::AttributeInNoNamespaceExists { .. }
          | Component::AttributeInNoNamespace { .. }
          | Component::AttributeOther(_)
          | Component::Root
          | Component::Empty
          | Component::Scope
          | Component::Nth(_)
          | Component::NonTSPseudoClass(_)
          | Component::Part(_)
          | Component::PseudoElement(_)
          | Component::Nesting => {}
        }
      }
    }
  }
}

fn compose_sparse_map<'a>(
  filename: &'a str,
  code: &str,
  output: &str,
  encoded_runs: Option<&[u32]>,
  sparse_map: &ParcelSourceMap,
) -> SourceMap<'a> {
  let (runs, line_starts) = decode_mapping_runs(code, encoded_runs.unwrap());

  let mut output_line_starts = vec![0];
  for (index, byte) in output.bytes().enumerate() {
    if byte == b'\n' {
      output_line_starts.push(index + 1);
    }
  }

  let mut builder = SourceMapBuilder::default();
  let source_id = builder.set_source_and_content(filename, "");

  for mapping in sparse_map.get_mappings() {
    if let Some(original) = mapping.original {
      let (source_line, source_column) = resolve_source_location(
        code,
        &runs,
        &line_starts,
        original.original_line,
        original.original_column,
      );
      builder.add_token(
        mapping.generated_line,
        utf16_length(
          &output[output_line_starts[mapping.generated_line as usize]
            ..output_line_starts[mapping.generated_line as usize]
              + mapping.generated_column as usize],
        ),
        source_line,
        source_column,
        Some(source_id),
        None,
      );
    } else {
      builder.add_token(
        mapping.generated_line,
        mapping.generated_column,
        0,
        0,
        None,
        None,
      );
    }
  }

  builder.into_sourcemap()
}

fn decode_mapping_runs(code: &str, encoded_runs: &[u32]) -> (Vec<MappingRun>, Vec<usize>) {
  let mut runs = Vec::with_capacity(encoded_runs.len() / 3);
  let mut line_starts = vec![0];
  let mut byte_cursor = 0usize;
  let mut line = 0u32;

  for encoded in encoded_runs.chunks_exact(3) {
    let header = encoded[0];
    let utf16_length = header / 2;
    let start_byte = byte_cursor;
    let start_line = line;
    let mut remaining = utf16_length;

    while remaining > 0 {
      let character = code[byte_cursor..].chars().next().unwrap();
      let character_utf16_length = character.len_utf16() as u32;
      remaining -= character_utf16_length;
      byte_cursor += character.len_utf8();

      if character == '\n' || character == '\x0c' {
        line_starts.push(byte_cursor);
        line += 1;
      } else if character == '\r' && code.as_bytes().get(byte_cursor) != Some(&b'\n') {
        line_starts.push(byte_cursor);
        line += 1;
      }
    }

    runs.push(MappingRun {
      start_byte,
      end_byte: byte_cursor,
      start_line,
      source_line: encoded[1],
      source_column: encoded[2],
      constant: header % 2 == 1,
    });
  }

  (runs, line_starts)
}

fn resolve_source_location(
  code: &str,
  runs: &[MappingRun],
  line_starts: &[usize],
  line: u32,
  byte_column: u32,
) -> (u32, u32) {
  let line_start = line_starts[line as usize];
  let offset = line_start + byte_column as usize;
  let run = runs
    .iter()
    .find(|run| offset >= run.start_byte && offset < run.end_byte)
    .unwrap();

  if run.constant {
    return (run.source_line, run.source_column);
  }

  let line_delta = line - run.start_line;
  let source_line = run.source_line + line_delta;
  let source_column = if line_delta == 0 {
    run.source_column + utf16_length(&code[run.start_byte..offset])
  } else {
    utf16_length(&code[line_start..offset])
  };

  (source_line, source_column)
}

fn utf16_length(value: &str) -> u32 {
  if value.is_ascii() {
    value.len() as u32
  } else {
    value.encode_utf16().count() as u32
  }
}

fn wrapper_rule<'i>(rules: CssRuleList<'i>, scoped_name: &str) -> CssRule<'i> {
  CssRule::Style(StyleRule {
    selectors: Selector::from(Component::NonTSPseudoClass(PseudoClass::Global {
      selector: Box::new(Selector::from(Component::Class(Ident(
        scoped_name.to_owned().into(),
      )))),
    }))
    .into(),
    vendor_prefix: VendorPrefix::empty(),
    declarations: DeclarationBlock::default(),
    rules,
    loc: Location {
      source_index: 0,
      line: 0,
      column: 1,
    },
  })
}
