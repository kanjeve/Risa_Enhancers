// src/builtins.ts

export const ASIR_KEYWORDS = [
    'if', 'while', 'for', 'return', 'break', 'continue', 'static', 'struct', 'do', 'else', 'extern',
    'def', 'endmodule', 'function', 'global', 'local', 'localif', 'module',
    'car', 'cdr', 'getopt', 'newstruct', 'map', 'pari', 'quote', 'recmap', 'timer',
    'end', 'quit', 'true','false',
]; 
export const ASIR_BUILTIN_FUNCTIONS = [
    'load', 'import', 'ctrl', 'cputime', 'append', 'gcd', 'list', 'matrix', 'print',
    'det', 'inv', 'sin', 'cos', 'tan', 'log', 'exp', 'sqrt', 'abs', 'floor', 'ceil',
    'round', 'eval', 'quote', 'map', 'reduce', 'length', 'typeof', 'char', 'size',
    '@pi', '@e', 
];