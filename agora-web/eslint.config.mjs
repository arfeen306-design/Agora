import nextVitals from "eslint-config-next";

const config = [
  ...nextVitals,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next_*/**",
      "out/**",
      "coverage/**",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
