import { calculateChecksum } from "../../utils/calculateChecksum";
import { Parser, Language, Node } from "web-tree-sitter";
import path from "node:path";

export type RustEntityType = "function" | "struct" | "impl" | "trait" | "enum" | "enum_variant" | "mod" | "type_alias" | "const" | "static" | "associated_type" | "associated_const" | "macro" | "union";

export interface RustEntity {
    /** Type of the entity */
    entityType: RustEntityType;
    /** Name of the entity */
    name: string;
    /** Fully qualified name (e.g., "module::Struct::method") */
    qualifiedName: string;
    /** The extracted code snippet */
    code: string;
    /** Parent struct/trait/impl name if this is a method */
    parentContext?: string;
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** SHA-256 checksum of the code */
    checksum: string;
    /** Whether the entity is exported (pub) */
    isExported: boolean;
    /** Doc comment if present */
    docstring?: string;
    /** Function/method parameters as string */
    parameters?: string;
    /** Return type as string */
    returnType?: string;
}

export interface ParsedRustFile {
    /** File path */
    filepath: string;
    /** All extracted entities */
    entities: RustEntity[];
    /** Use/import statements in the file */
    imports: string[];
    /** Module-level doc comment */
    moduleDoc?: string;
}

interface RustAstEntity {
    kind: RustEntityType;
    name: string;
    parent?: string;
    startLine: number;
    endLine: number;
    docstring?: string;
    parameters?: string;
    returnType?: string;
    isExported: boolean;
}

interface RustAstResult {
    imports: string[];
    moduleDoc?: string;
    entities: RustAstEntity[];
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
        
        // Load Rust language from WASM file
        const rustWasmPath = path.join(__dirname, "../../../node_modules/tree-sitter-rust/tree-sitter-rust.wasm");
        const RustLang = await Language.load(rustWasmPath);
        const parser = new Parser();
        parser.setLanguage(RustLang);
        parserInstance = parser;
        return parser;
    })();

    return parserLoadPromise;
}

export async function parseRustFile(
    filepath: string,
    content: string,
): Promise<ParsedRustFile> {
    const filename = filepath.split(/[\\/]/).pop() ?? filepath;
    const moduleName = filename.replace(/\.rs$/i, "");

    const astResult = await runRustAstAnalysis(filepath, content);

    const entities: RustEntity[] = [];

    // Only add module-level entity if there are no individual entities
    // This prevents duplication and poor chunking when individual functions/structs/traits exist
    // The module entity is only useful when the file contains only module-level code
    if (content.trim().length > 0 && astResult.entities.length === 0) {
        // Calculate endLine correctly: count newlines and handle trailing newline
        const newlineCount = (content.match(/\n/g) || []).length;
        const endLine = content.endsWith("\n") ? newlineCount : newlineCount + 1;
        
        entities.push({
            entityType: "mod",
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
            ? `${moduleName}::${e.parent}::${e.name}`
            : `${moduleName}::${e.name}`;

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
            isExported: e.isExported,
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

function extractDocComment(node: Node, content: string): string | undefined {
    // Rust uses /// for doc comments
    // Look for preceding doc comments
    const startIndex = node.startIndex;
    let docLines: string[] = [];
    
    // Search backwards for doc comments
    let searchIndex = startIndex - 1;
    while (searchIndex >= 0) {
        const char = content[searchIndex];
        if (char === '\n') {
            const lineStart = content.lastIndexOf('\n', searchIndex - 1) + 1;
            const lineEnd = searchIndex;
            const line = content.substring(lineStart, lineEnd).trim();
            
            if (line.startsWith('///')) {
                // Remove /// and trim
                const docLine = line.substring(3).trim();
                docLines.unshift(docLine);
            } else if (line.startsWith('//!')) {
                // Module-level doc comment
                const docLine = line.substring(3).trim();
                docLines.unshift(docLine);
            } else if (line === '' || line.startsWith('//')) {
                // Regular comment or blank line, continue searching
            } else {
                // Non-comment line, stop
                break;
            }
            
            searchIndex = lineStart - 1;
        } else {
            searchIndex--;
        }
        
        // Limit search to avoid going too far back
        if (startIndex - searchIndex > 1000) break;
    }
    
    return docLines.length > 0 ? docLines.join('\n') : undefined;
}

function extractParameters(node: Node, content: string): string {
    const parameters = node.childForFieldName("parameters");
    if (!parameters) {
        // Try to find parameter list in function signature
        const signature = node.childForFieldName("signature");
        if (signature) {
            const params = signature.childForFieldName("parameters");
            if (params) {
                const start = params.startIndex;
                const end = params.endIndex;
                return content.substring(start, end);
            }
        }
        return "()";
    }

    const start = parameters.startIndex;
    const end = parameters.endIndex;
    return content.substring(start, end);
}

function extractReturnType(node: Node, content: string): string | undefined {
    // Rust return type is in the signature
    const signature = node.childForFieldName("signature");
    if (signature) {
        const returnType = signature.childForFieldName("return_type");
        if (returnType) {
            const start = returnType.startIndex;
            const end = returnType.endIndex;
            return content.substring(start, end).trim() || undefined;
        }
    }
    return undefined;
}

function extractUseStatement(node: Node, content: string): string {
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

function isPublic(node: Node): boolean {
    // Check for pub keyword in modifiers
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === "visibility_modifier") {
            return true;
        }
        // Also check for pub keyword directly
        if (child && child.type === "pub") {
            return true;
        }
    }
    return false;
}

function traverseTree(
    node: Node,
    content: string,
    result: RustAstResult,
    parentStruct?: string
): void {
    const nodeType = node.type;

    // Handle use statements (imports)
    if (nodeType === "use_declaration") {
        result.imports.push(extractUseStatement(node, content));
        return;
    }

    // Handle function definitions
    if (nodeType === "function_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const parameters = extractParameters(node, content);
        const returnType = extractReturnType(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "function", // Rust functions are always "function" type, even when inside impl blocks
            name,
            parent: parentStruct,
            startLine: startRow + 1, // tree-sitter uses 0-based, we use 1-based
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            parameters,
            returnType,
            isExported,
        });
        return;
    }

    // Handle struct definitions
    if (nodeType === "struct_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "struct",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle impl blocks
    if (nodeType === "impl_item") {
        const typeNode = node.childForFieldName("type");
        const traitNode = node.childForFieldName("trait");
        const structName = typeNode ? extractName(typeNode) : undefined;
        const traitName = traitNode ? extractName(traitNode) : undefined;
        
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        // Create impl entity
        const implName = structName ? (traitName ? `${structName}::${traitName}` : structName) : "impl";
        result.entities.push({
            kind: "impl",
            name: implName,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });

        // Traverse impl body to find methods
        const body = node.childForFieldName("body");
        if (body) {
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (child && child.type === "function_item") {
                    traverseTree(child, content, result, structName);
                }
            }
        }
        return;
    }

    // Handle trait definitions
    if (nodeType === "trait_item") {
        const traitName = extractName(node);
        if (!traitName) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "trait",
            name: traitName,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });

        // Traverse trait body to find method signatures
        // Trait methods can be:
        // 1. associated_function (method signatures without bodies) - this is the main case
        // 2. function_item (default implementations with bodies)
        // 3. Other associated items (types, constants, etc.)
        const body = node.childForFieldName("body");
        if (body) {
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (child) {
                    // Handle trait method signatures (without bodies)
                    // Tree-sitter-rust uses different node types for trait methods:
                    // - associated_function: trait method signatures
                    // - function_signature_item: alternative node type
                    // - function_item: default implementations with bodies
                    const isTraitMethodSignature = 
                        child.type === "associated_function" || 
                        child.type === "function_signature_item" ||
                        (child.type === "function_item" && !child.childForFieldName("body"));
                    
                    if (isTraitMethodSignature) {
                        const methodName = extractName(child);
                        if (methodName) {
                            const startRow = child.startPosition.row;
                            const endRow = child.endPosition.row;
                            const docstring = extractDocComment(child, content);
                            const parameters = extractParameters(child, content);
                            const returnType = extractReturnType(child, content);
                            const isExported = isPublic(child);

                            result.entities.push({
                                kind: "function",
                                name: methodName,
                                parent: traitName, // Parent is the trait name
                                startLine: startRow + 1,
                                endLine: endRow,
                                docstring,
                                parameters,
                                returnType,
                                isExported,
                            });
                            continue; // Skip recursive traversal for this node
                        }
                    }
                    // Handle associated types in traits (type MyType;)
                    if (child.type === "associated_type") {
                        const typeName = extractName(child);
                        if (typeName) {
                            const startRow = child.startPosition.row;
                            const endRow = child.endPosition.row;
                            const docstring = extractDocComment(child, content);
                            const isExported = isPublic(child);

                            result.entities.push({
                                kind: "associated_type",
                                name: typeName,
                                parent: traitName,
                                startLine: startRow + 1,
                                endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
                                docstring,
                                isExported,
                            });
                            continue;
                        }
                    }

                    // Handle associated constants in traits (const MY_CONST: Type;)
                    if (child.type === "associated_const") {
                        const constName = extractName(child);
                        if (constName) {
                            const startRow = child.startPosition.row;
                            const endRow = child.endPosition.row;
                            const docstring = extractDocComment(child, content);
                            const isExported = isPublic(child);

                            result.entities.push({
                                kind: "associated_const",
                                name: constName,
                                parent: traitName,
                                startLine: startRow + 1,
                                endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
                                docstring,
                                isExported,
                            });
                            continue;
                        }
                    }

                    // Also handle function_item (for default implementations in traits)
                    // Recursively traverse all children to catch any other patterns
                    traverseTree(child, content, result, traitName);
                }
            }
        }
        return;
    }

    // Handle enum definitions
    if (nodeType === "enum_item") {
        const enumName = extractName(node);
        if (!enumName) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "enum",
            name: enumName,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });

        // Extract individual enum variants
        const body = node.childForFieldName("body");
        if (body) {
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (child && child.type === "variant_item") {
                    const variantName = extractName(child);
                    if (variantName) {
                        const variantStartRow = child.startPosition.row;
                        const variantEndRow = child.endPosition.row;
                        const variantDocstring = extractDocComment(child, content);
                        const variantIsExported = isExported; // Variants inherit enum visibility

                        result.entities.push({
                            kind: "enum_variant",
                            name: variantName,
                            startLine: variantStartRow + 1,
                            endLine: variantEndRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
                            docstring: variantDocstring,
                            isExported: variantIsExported,
                        });
                    }
                }
            }
        }
        return;
    }

    // Handle type aliases
    if (nodeType === "type_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "type_alias",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle const declarations
    if (nodeType === "const_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "const",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle static declarations
    if (nodeType === "static_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "static",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle macro definitions (macro_rules!)
    if (nodeType === "macro_definition" || nodeType === "macro_rules") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "macro",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle module declarations (mod my_module; or mod my_module { ... })
    if (nodeType === "mod_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "mod",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        // Continue traversing to extract items inside the module
        return;
    }

    // Handle union types
    if (nodeType === "union_item") {
        const name = extractName(node);
        if (!name) return;

        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const docstring = extractDocComment(node, content);
        const isExported = isPublic(node);

        result.entities.push({
            kind: "union",
            name,
            startLine: startRow + 1,
            endLine: endRow, // endPosition.row is 0-based exclusive (points to line after), which equals 1-based inclusive
            docstring,
            isExported,
        });
        return;
    }

    // Handle module-level doc comment (//! or /// at the top)
    if (nodeType === "line_comment" && !result.moduleDoc) {
        const text = node.text;
        if (text.startsWith("//!")) {
            const docLine = text.substring(3).trim();
            result.moduleDoc = docLine;
        }
    }

    // Recursively traverse children
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
            traverseTree(child, content, result, parentStruct);
        }
    }
}

async function runRustAstAnalysis(filepath: string, content: string): Promise<RustAstResult> {
    try {
        const parser = await getParser();
        const tree = parser.parse(content);
        
        if (!tree) {
            return { imports: [], moduleDoc: undefined, entities: [] };
        }
        
        const result: RustAstResult = {
            imports: [],
            moduleDoc: undefined,
            entities: [],
        };

        // Extract module doc from leading comments
        const lines = content.split('\n');
        const moduleDocLines: string[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//!')) {
                moduleDocLines.push(trimmed.substring(3).trim());
            } else if (trimmed.startsWith('///') && moduleDocLines.length > 0) {
                // Continue doc comment
                moduleDocLines.push(trimmed.substring(3).trim());
            } else if (trimmed === '' && moduleDocLines.length > 0) {
                // Blank line in doc comment
                continue;
            } else {
                // Non-doc line, stop
                break;
            }
        }
        if (moduleDocLines.length > 0) {
            result.moduleDoc = moduleDocLines.join('\n');
        }

        // Traverse the tree starting from the root
        traverseTree(tree.rootNode, content, result);

        return result;
    } catch (error) {
        // Fallback: return empty result if parsing fails
        console.warn(`Failed to parse Rust file ${filepath}:`, error);
        return { imports: [], moduleDoc: undefined, entities: [] };
    }
}

