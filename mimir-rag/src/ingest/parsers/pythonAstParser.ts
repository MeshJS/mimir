import { calculateChecksum } from "../../utils/calculateChecksum";
import { Parser, Language, Node } from "web-tree-sitter";
import path from "node:path";

export type PythonEntityType = "function" | "class" | "method" | "variable" | "module";

export interface PythonEntity {
    /** Type of the entity */
    entityType: PythonEntityType;
    /** Name of the entity (for module, usually the filename without extension) */
    name: string;
    /** Fully qualified name (e.g., "module.ClassName.method_name") */
    qualifiedName: string;
    /** The extracted code snippet */
    code: string;
    /** Parent class name if this is a method */
    parentContext?: string;
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** SHA-256 checksum of the code */
    checksum: string;
    /** Whether the entity is exported (Python has no explicit exports; this is always false for now) */
    isExported: boolean;
    /** Docstring if present */
    docstring?: string;
    /** Function/method parameters as string */
    parameters?: string;
    /** Return type annotation as string */
    returnType?: string;
}

export interface ParsedPythonFile {
    /** File path */
    filepath: string;
    /** All extracted entities */
    entities: PythonEntity[];
    /** Import statements in the file */
    imports: string[];
    /** Module-level docstring */
    moduleDoc?: string;
}

interface PythonAstEntity {
    kind: "function" | "class" | "method" | "variable";
    name: string;
    parent?: string;
    startLine: number;
    endLine: number;
    docstring?: string;
    parameters?: string;
    returnType?: string;
}

interface PythonAstResult {
    imports: string[];
    moduleDoc?: string;
    entities: PythonAstEntity[];
}

// Lazy-loaded parser instance
let parserInstance: Parser | null = null;
let parserLoadPromise: Promise<Parser> | null = null;

async function getParser(): Promise<Parser> {
    if (parserInstance) {
        return parserInstance;
    }
    
    if (parserLoadPromise) {
        return parserLoadPromise;
    }

    parserLoadPromise = (async () => {
        // Initialize WebAssembly module before loading languages
        await Parser.init();
        
        // Load Python language from WASM file
        const pythonWasmPath = path.join(__dirname, "../../../node_modules/tree-sitter-python/tree-sitter-python.wasm");
        const PythonLang = await Language.load(pythonWasmPath);
        const parser = new Parser();
        parser.setLanguage(PythonLang);
        parserInstance = parser;
        return parser;
    })();

    return parserLoadPromise;
}

export async function parsePythonFile(
    filepath: string,
    content: string,
): Promise<ParsedPythonFile> {
    const filename = filepath.split(/[\\/]/).pop() ?? filepath;
    const moduleName = filename.replace(/\.py$/i, "");

    const astResult = await runPythonAstAnalysis(filepath, content);

    const entities: PythonEntity[] = [];

    // Only add module-level entity if there are no individual entities
    // This prevents duplication and poor chunking when individual functions/classes exist
    // The module entity is only useful when the file contains only module-level code
    if (content.trim().length > 0 && astResult.entities.length === 0) {
        // Calculate endLine correctly: count newlines and handle trailing newline
        // If content ends with newline, the trailing newline doesn't create a new content line
        // Example: "line1\nline2\n" has 2 newlines but only 2 lines of content
        const newlineCount = (content.match(/\n/g) || []).length;
        const endLine = content.endsWith("\n") ? newlineCount : newlineCount + 1;
        
        entities.push({
            entityType: "module",
            name: moduleName,
            qualifiedName: moduleName,
            code: content,
            parentContext: undefined,
            startLine: 1,
            endLine: endLine,
            checksum: calculateChecksum(content),
            isExported: false,
            docstring: astResult.moduleDoc,
        });
    }

    for (const e of astResult.entities) {
        const qualifiedName = e.parent
            ? `${moduleName}.${e.parent}.${e.name}`
            : `${moduleName}.${e.name}`;

        const lines = content.split("\n").slice(e.startLine - 1, e.endLine);
        const code = lines.join("\n");

        entities.push({
            entityType: e.kind,
            name: e.name,
            qualifiedName,
            code,
            parentContext: e.parent,
            startLine: e.startLine,
            endLine: e.endLine,
            checksum: calculateChecksum(code),
             isExported: false,
            docstring: e.docstring,
            parameters: e.parameters,
            returnType: e.returnType,
        });
    }

    return {
        filepath,
        entities,
        imports: astResult.imports,
        moduleDoc: astResult.moduleDoc,
    };
}

function extractDocstring(node: Node, content: string): string | undefined {
    // Look for docstring as first statement in function/class body
    const body = node.childForFieldName("body");
    if (!body) return undefined;

    const firstStmt = body.namedChildren[0];
    if (!firstStmt) return undefined;

    // Check if first statement is an expression statement with a string
    if (firstStmt.type === "expression_statement") {
        const expr = firstStmt.firstChild;
        if (expr && (expr.type === "string" || expr.type === "concatenated_string")) {
            const start = expr.startIndex;
            const end = expr.endIndex;
            let docstring = content.substring(start, end);
            // Remove quotes (handles both single and triple quotes)
            docstring = docstring.replace(/^["']{1,3}|["']{1,3}$/g, "");
            return docstring.trim() || undefined;
        }
    }
    return undefined;
}

function extractParameters(node: Node, content: string): string {
    const parameters = node.childForFieldName("parameters");
    if (!parameters) return "()";

    const start = parameters.startIndex;
    const end = parameters.endIndex;
    return content.substring(start, end);
}

function extractReturnType(node: Node, content: string): string | undefined {
    const returnType = node.childForFieldName("return_type");
    if (!returnType) return undefined;

    const start = returnType.startIndex;
    const end = returnType.endIndex;
    return content.substring(start, end).trim() || undefined;
}

function extractImportStatement(node: Node, content: string): string {
    const start = node.startIndex;
    const end = node.endIndex;
    return content.substring(start, end).trim();
}

function extractName(node: Node): string | undefined {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
        return nameNode.text;
    }
    // Fallback: look for identifier in children
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === "identifier") {
            return child.text;
        }
    }
    return undefined;
}

function traverseTree(
    node: Node,
    content: string,
    result: PythonAstResult,
    parentClass?: string
): void {
    const nodeType = node.type;

    // Handle imports
    if (nodeType === "import_statement" || nodeType === "import_from_statement") {
        result.imports.push(extractImportStatement(node, content));
        return;
    }

    // Handle function definitions
    if (nodeType === "function_definition" || nodeType === "decorated_definition") {
        const funcNode = nodeType === "decorated_definition" 
            ? node.childForFieldName("definition") 
            : node;
        
        if (!funcNode || funcNode.type !== "function_definition") return;

        const name = extractName(funcNode);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocstring(funcNode, content);
        const parameters = extractParameters(funcNode, content);
        const returnType = extractReturnType(funcNode, content);

        result.entities.push({
            kind: parentClass ? "method" : "function",
            name,
            parent: parentClass,
            startLine: startRow + 1, // tree-sitter uses 0-based, we use 1-based
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            parameters,
            returnType,
        });
        return;
    }

    // Handle class definitions
    if (nodeType === "class_definition") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocstring(node, content);

        result.entities.push({
            kind: "class",
            name,
            startLine: startRow + 1, // tree-sitter uses 0-based, we use 1-based
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
        });

        // Traverse class body to find methods
        const body = node.childForFieldName("body");
        if (body) {
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (child) {
                    traverseTree(child, content, result, name);
                }
            }
        }
        return;
    }

    // Handle module-level docstring (first statement if it's a string)
    if (nodeType === "expression_statement" && !result.moduleDoc) {
        const expr = node.firstChild;
        if (expr && (expr.type === "string" || expr.type === "concatenated_string")) {
            const start = expr.startIndex;
            const end = expr.endIndex;
            let docstring = content.substring(start, end);
            docstring = docstring.replace(/^["']{1,3}|["']{1,3}$/g, "");
            result.moduleDoc = docstring.trim() || undefined;
        }
    }

    // Recursively traverse children
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
            traverseTree(child, content, result, parentClass);
        }
    }
}

async function runPythonAstAnalysis(filepath: string, content: string): Promise<PythonAstResult> {
    try {
        const parser = await getParser();
        const tree = parser.parse(content);
        
        if (!tree) {
            return { imports: [], moduleDoc: undefined, entities: [] };
        }
        
        const result: PythonAstResult = {
            imports: [],
            moduleDoc: undefined,
            entities: [],
        };

        // Traverse the tree starting from the root
        traverseTree(tree.rootNode, content, result);

        return result;
    } catch (error) {
        // Fallback: return empty result if parsing fails
        return { imports: [], moduleDoc: undefined, entities: [] };
    }
}

