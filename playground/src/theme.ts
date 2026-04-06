console.log("theme");

export const theme = {
  colors: {
    primary: "blue",
    secondary: "darkred",
  },
  gap: 5,
};

// Also export a function to prove compile-time JS execution
export const multiply = (a: number, b: number) => a * b;
