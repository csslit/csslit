export function createCsslitCapture(block: { patch_lines: number[] }) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    let code = "";
    const patches: { line: number; count: number }[] = [];

    for (let index = 0; index < strings.length; index += 1) {
      code += strings[index] ?? "";

      if (index >= values.length) continue;

      const value = String(values[index]);
      code += value;

      const count = value.match(/\r\n?|\n/g)?.length ?? 0;
      const line = block.patch_lines[index];

      if (count > 0 && typeof line === "number") {
        patches.push({ line, count });
      }
    }

    return { code, patches };
  };
}

function patchMappings(mappings: string, patches: { line: number; count: number }[]) {
  if (patches.length === 0) {
    return mappings;
  }

  let result = "";
  let cursor = 0;
  let line = 0;
  let patchIndex = 0;

  while (true) {
    while (patchIndex < patches.length && patches[patchIndex]!.line === line) {
      result += ";".repeat(patches[patchIndex]!.count);
      patchIndex += 1;
    }

    const end = mappings.indexOf(";", cursor);
    if (end === -1) {
      result += mappings.slice(cursor);
      break;
    }

    result += mappings.slice(cursor, end + 1);
    cursor = end + 1;
    line += 1;
  }

  return result;
}

export function finalizeCsslitEvalResult({
  blocks,
  map,
}: {
  blocks: { code: string; patches: { line: number; count: number }[] }[];
  map: { mappings: string } | null;
}) {
  let code = "";
  const patches: { line: number; count: number }[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;

    if (index > 0) {
      code += "\n";
    }

    code += `.csslit_${index} {\n${block.code}\n}`;
    patches.push(...block.patches);
  }

  return {
    code,
    map: map ? { ...map, mappings: patchMappings(map.mappings, patches) } : null,
  };
}
