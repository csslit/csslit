<script setup lang="ts">
import { css } from "@csslit/core";

const accent = "rebeccapurple";

css.global`
  body {
    margin: 0;
  }
`;

const panel = css`
  display: grid;
  min-height: 100vh;
  place-items: center;
  color: white;
  background: ${accent};
  font: 600 2rem/1.2 system-ui;
`;
</script>

<template>
  <main :class="panel">csslit + Vue</main>
</template>
