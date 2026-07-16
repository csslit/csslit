use oxc_allocator::{GetAllocator, Vec};

pub(crate) struct BitSet<'alloc> {
  words: &'alloc mut [usize],
}

impl<'alloc> BitSet<'alloc> {
  pub(crate) fn new_in(capacity: usize, allocator: &impl GetAllocator<'alloc>) -> Self {
    let word_count = capacity.div_ceil(usize::BITS as usize);
    let mut words = Vec::with_capacity_in(word_count, allocator);
    words.resize(word_count, 0usize);
    Self {
      words: words.into_arena_slice_mut(),
    }
  }

  pub(crate) fn get(&self, index: usize) -> bool {
    let bits = usize::BITS as usize;
    self.words[index / bits] & (1usize << (index % bits)) != 0
  }

  pub(crate) fn set(&mut self, index: usize, value: bool) {
    let bits = usize::BITS as usize;
    let word = &mut self.words[index / bits];
    let mask = 1usize << (index % bits);
    if value {
      *word |= mask;
    } else {
      *word &= !mask;
    }
  }
}
