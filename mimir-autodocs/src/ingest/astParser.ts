import ts from "typescript";
import { calculateChecksum } from "../utils/calculateChecksum";
import type { ParserConfig } from "../config/types";

export type EntityType = "function" | "class" | "interface" | "type" | "enum" | "method" | "variable";

export interface TypeScriptEntity {
    /** Type of the entity */
    entityType: EntityType;
    /** Name of the entity */
    name: string;
    /** Fully qualified name (e.g., "ClassName.methodName") */
    qualifiedName: string;
    /** The extracted code snippet */
    code: string;
    /** Parent class/interface name if this is a nested entity */
    parentContext?: string;
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** SHA-256 checksum of the code */
    checksum: string;
    /** Whether the entity is exported */
    isExported: boolean;
    /** JSDoc comment if present */
    jsDoc?: string;
    /** Function/method parameters as string */
    parameters?: string;
    /** Return type as string */
    returnType?: string;
}

export interface ParsedFile {
    /** File path */
    filepath: string;
    /** All extracted entities */
    entities: TypeScriptEntity[];
    /** Import statements in the file */
    imports: string[];
    /** File-level JSDoc or module documentation */
    moduleDoc?: string;
}

interface ParserContext {
    sourceFile: ts.SourceFile;
    config: ParserConfig;
}

/**
 * Parse a TypeScript file and extract all code entities
 */
export function parseTypescriptFile(
    filepath: string,
    content: string,
    config?: ParserConfig
): ParsedFile {
    const sourceFile = ts.createSourceFile(
        filepath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filepath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const parserConfig: ParserConfig = {
        extractVariables: config?.extractVariables ?? false,
        extractMethods: config?.extractMethods ?? true,
        excludePatterns: config?.excludePatterns ?? [],
    };

    const context: ParserContext = {
        sourceFile,
        config: parserConfig,
    };

    const entities: TypeScriptEntity[] = [];
    const imports: string[] = [];
    let moduleDoc: string | undefined;

    // Extract leading comments as module doc
    const leadingComments = getLeadingComments(sourceFile, sourceFile);
    if (leadingComments) {
        moduleDoc = leadingComments;
    }

    // Walk through all top-level statements
    ts.forEachChild(sourceFile, (node) => {
        // Collect imports
        if (ts.isImportDeclaration(node)) {
            imports.push(node.getText(sourceFile));
            return;
        }

        // Extract entities
        const extracted = extractEntity(node, context);
        if (extracted) {
            entities.push(...extracted);
        }
    });

    return {
        filepath,
        entities,
        imports,
        moduleDoc,
    };
}

function extractEntity(
    node: ts.Node,
    context: ParserContext,
    parentName?: string
): TypeScriptEntity[] | null {
    const { sourceFile, config } = context;
    const entities: TypeScriptEntity[] = [];

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
        const entity = extractFunctionEntity(node, sourceFile, parentName);
        if (entity) entities.push(entity);
    }
    // Class declarations
    else if (ts.isClassDeclaration(node) && node.name) {
        const classEntity = extractClassEntity(node, sourceFile);
        if (classEntity) {
            entities.push(classEntity);

            // Extract methods if configured
            if (config.extractMethods) {
                const methods = extractClassMembers(node, sourceFile, classEntity.name);
                entities.push(...methods);
            }
        }
    }
    // Interface declarations
    else if (ts.isInterfaceDeclaration(node)) {
        const entity = extractInterfaceEntity(node, sourceFile);
        if (entity) entities.push(entity);
    }
    // Type alias declarations
    else if (ts.isTypeAliasDeclaration(node)) {
        const entity = extractTypeAliasEntity(node, sourceFile);
        if (entity) entities.push(entity);
    }
    // Enum declarations
    else if (ts.isEnumDeclaration(node)) {
        const entity = extractEnumEntity(node, sourceFile);
        if (entity) entities.push(entity);
    }
    // Variable statements (const/let/var with arrow functions or important values)
    else if (ts.isVariableStatement(node) && config.extractVariables) {
        const variableEntities = extractVariableEntities(node, sourceFile);
        entities.push(...variableEntities);
    }
    // Export assignments (export default)
    else if (ts.isExportAssignment(node)) {
        // Skip for now - usually references other entities
    }

    return entities.length > 0 ? entities : null;
}

function extractFunctionEntity(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile,
    parentName?: string
): TypeScriptEntity | null {
    const name = node.name?.getText(sourceFile);
    if (!name) return null;

    const code = node.getText(sourceFile);
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
        entityType: "function",
        name,
        qualifiedName: parentName ? `${parentName}.${name}` : name,
        code,
        parentContext: parentName,
        startLine: startLine + 1,
        endLine: endLine + 1,
        checksum: calculateChecksum(code),
        isExported: hasExportModifier(node),
        jsDoc: getJsDoc(node, sourceFile),
        parameters: getParametersString(node, sourceFile),
        returnType: getReturnTypeString(node, sourceFile),
    };
}

function extractClassEntity(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile
): TypeScriptEntity | null {
    const name = node.name?.getText(sourceFile);
    if (!name) return null;

    const code = node.getText(sourceFile);
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
        entityType: "class",
        name,
        qualifiedName: name,
        code,
        startLine: startLine + 1,
        endLine: endLine + 1,
        checksum: calculateChecksum(code),
        isExported: hasExportModifier(node),
        jsDoc: getJsDoc(node, sourceFile),
    };
}

function extractClassMembers(
    classNode: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    className: string
): TypeScriptEntity[] {
    const members: TypeScriptEntity[] = [];

    classNode.members.forEach((member) => {
        // Methods
        if (ts.isMethodDeclaration(member) && member.name) {
            const name = member.name.getText(sourceFile);
            const code = member.getText(sourceFile);
            const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
            const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(member.getEnd());

            members.push({
                entityType: "method",
                name,
                qualifiedName: `${className}.${name}`,
                code,
                parentContext: className,
                startLine: startLine + 1,
                endLine: endLine + 1,
                checksum: calculateChecksum(code),
                isExported: hasExportModifier(classNode), // Inherit from class
                jsDoc: getJsDoc(member, sourceFile),
                parameters: getParametersString(member, sourceFile),
                returnType: getReturnTypeString(member, sourceFile),
            });
        }
        // Constructor
        else if (ts.isConstructorDeclaration(member)) {
            const code = member.getText(sourceFile);
            const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
            const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(member.getEnd());

            members.push({
                entityType: "method",
                name: "constructor",
                qualifiedName: `${className}.constructor`,
                code,
                parentContext: className,
                startLine: startLine + 1,
                endLine: endLine + 1,
                checksum: calculateChecksum(code),
                isExported: hasExportModifier(classNode),
                jsDoc: getJsDoc(member, sourceFile),
                parameters: getParametersString(member, sourceFile),
            });
        }
    });

    return members;
}

function extractInterfaceEntity(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile
): TypeScriptEntity | null {
    const name = node.name.getText(sourceFile);
    const code = node.getText(sourceFile);
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
        entityType: "interface",
        name,
        qualifiedName: name,
        code,
        startLine: startLine + 1,
        endLine: endLine + 1,
        checksum: calculateChecksum(code),
        isExported: hasExportModifier(node),
        jsDoc: getJsDoc(node, sourceFile),
    };
}

function extractTypeAliasEntity(
    node: ts.TypeAliasDeclaration,
    sourceFile: ts.SourceFile
): TypeScriptEntity | null {
    const name = node.name.getText(sourceFile);
    const code = node.getText(sourceFile);
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
        entityType: "type",
        name,
        qualifiedName: name,
        code,
        startLine: startLine + 1,
        endLine: endLine + 1,
        checksum: calculateChecksum(code),
        isExported: hasExportModifier(node),
        jsDoc: getJsDoc(node, sourceFile),
    };
}

function extractEnumEntity(
    node: ts.EnumDeclaration,
    sourceFile: ts.SourceFile
): TypeScriptEntity | null {
    const name = node.name.getText(sourceFile);
    const code = node.getText(sourceFile);
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
        entityType: "enum",
        name,
        qualifiedName: name,
        code,
        startLine: startLine + 1,
        endLine: endLine + 1,
        checksum: calculateChecksum(code),
        isExported: hasExportModifier(node),
        jsDoc: getJsDoc(node, sourceFile),
    };
}

function extractVariableEntities(
    node: ts.VariableStatement,
    sourceFile: ts.SourceFile
): TypeScriptEntity[] {
    const entities: TypeScriptEntity[] = [];

    node.declarationList.declarations.forEach((declaration) => {
        if (!ts.isIdentifier(declaration.name)) return;

        const name = declaration.name.getText(sourceFile);
        
        // Only extract if it's an arrow function or has type annotation
        const hasArrowFunction = declaration.initializer && ts.isArrowFunction(declaration.initializer);
        const hasTypeAnnotation = declaration.type !== undefined;
        
        if (!hasArrowFunction && !hasTypeAnnotation) return;

        const code = node.getText(sourceFile);
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        const entity: TypeScriptEntity = {
            entityType: hasArrowFunction ? "function" : "variable",
            name,
            qualifiedName: name,
            code,
            startLine: startLine + 1,
            endLine: endLine + 1,
            checksum: calculateChecksum(code),
            isExported: hasExportModifier(node),
            jsDoc: getJsDoc(node, sourceFile),
        };

        // Extract parameters and return type for arrow functions
        if (hasArrowFunction && ts.isArrowFunction(declaration.initializer!)) {
            const arrowFn = declaration.initializer as ts.ArrowFunction;
            entity.parameters = getParametersString(arrowFn, sourceFile);
            entity.returnType = getReturnTypeString(arrowFn, sourceFile);
        }

        entities.push(entity);
    });

    return entities;
}

function hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some(
        (mod) => mod.kind === ts.SyntaxKind.ExportKeyword || mod.kind === ts.SyntaxKind.DefaultKeyword
    );
}

function getJsDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    const jsDocComments = ts.getJSDocCommentsAndTags(node);
    if (jsDocComments.length === 0) return undefined;

    const comments = jsDocComments
        .filter((comment): comment is ts.JSDoc => ts.isJSDoc(comment))
        .map((jsDoc) => jsDoc.getText(sourceFile))
        .join("\n");

    return comments || undefined;
}

function getLeadingComments(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    const fullText = sourceFile.getFullText();
    const nodeStart = node.getFullStart();
    const leadingTrivia = fullText.substring(0, nodeStart);
    
    // Look for block comments at the start of the file
    const blockCommentMatch = leadingTrivia.match(/\/\*[\s\S]*?\*\//);
    if (blockCommentMatch) {
        return blockCommentMatch[0];
    }

    return undefined;
}

function getParametersString(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.ConstructorDeclaration,
    sourceFile: ts.SourceFile
): string {
    const params = node.parameters.map((param) => param.getText(sourceFile));
    return `(${params.join(", ")})`;
}

function getReturnTypeString(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction,
    sourceFile: ts.SourceFile
): string | undefined {
    if (node.type) {
        return node.type.getText(sourceFile);
    }
    return undefined;
}

/**
 * Get a summary of the file structure for context
 */
export function getFileSummary(parsed: ParsedFile): string {
    const lines: string[] = [];

    if (parsed.imports.length > 0) {
        lines.push("Imports:");
        parsed.imports.forEach((imp) => lines.push(`  ${imp}`));
        lines.push("");
    }

    const entityGroups = new Map<EntityType, TypeScriptEntity[]>();
    parsed.entities.forEach((entity) => {
        const group = entityGroups.get(entity.entityType) ?? [];
        group.push(entity);
        entityGroups.set(entity.entityType, group);
    });

    const typeOrder: EntityType[] = ["interface", "type", "enum", "class", "function", "method", "variable"];
    
    for (const type of typeOrder) {
        const group = entityGroups.get(type);
        if (!group || group.length === 0) continue;

        lines.push(`${type.charAt(0).toUpperCase() + type.slice(1)}s:`);
        group.forEach((entity) => {
            const exported = entity.isExported ? "export " : "";
            const params = entity.parameters ?? "";
            const returnType = entity.returnType ? `: ${entity.returnType}` : "";
            lines.push(`  ${exported}${entity.qualifiedName}${params}${returnType}`);
        });
        lines.push("");
    }

    return lines.join("\n").trim();
}

