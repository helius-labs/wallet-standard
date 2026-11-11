/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
export default {
    preset: 'ts-jest/presets/default-esm',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    resolver: '../../core/util/jest.resolver.cjs',
    setupFiles: ['./jest.setup.cjs'],
    globals: {
        'ts-jest': {
            tsconfig: './tsconfig.tests.json',
        },
    },
    testEnvironment: 'node',
    transformIgnorePatterns: ['/node_modules/(?!(uuid))'],
};
