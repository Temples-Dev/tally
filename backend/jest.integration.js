module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: "test/integration/.*\\.int-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        tsconfig: {
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      },
    ],
  },
  testTimeout: 60_000,
  maxWorkers: 1,
};