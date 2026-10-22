import next from "eslint-config-next";

// eslint-config-next が登録している react-hooks プラグインを再利用する（直接依存に無いため import しない）
const reactHooks = next.map((c) => c.plugins && c.plugins["react-hooks"]).find(Boolean);

const eslintConfig = [
  ...next,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // eslint-config-next 16.4（eslint-plugin-react-hooks 7.1）で追加された React Compiler 由来のルール。
    // 既存の UI コード（useEffect 内の setState 等）が多数該当するが動作上の不具合ではないため、
    // セキュリティ更新では警告に留める。個別の書き換えは別タスクで行う。
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
