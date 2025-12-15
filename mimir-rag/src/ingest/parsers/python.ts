import { parsePythonFile, ParsedPythonFile, PythonEntity } from "../pythonAstParser";
import type { CodeParsedFile, CodeEntity } from "./types";

export function parsePythonCodeFile(
    filepath: string,
    content: string
): CodeParsedFile {
    const parsed: ParsedPythonFile = parsePythonFile(filepath, content);

    const entities: CodeEntity[] = parsed.entities.map((e: PythonEntity) => ({
        entityType: e.entityType,
        name: e.name,
        qualifiedName: e.qualifiedName,
        code: e.code,
        parentContext: e.parentContext,
        startLine: e.startLine,
        endLine: e.endLine,
        checksum: e.checksum,
        isExported: e.isExported,
        docstring: e.docstring,
        parameters: e.parameters,
        returnType: e.returnType,
    }));

    return {
        filepath: parsed.filepath,
        entities,
        imports: parsed.imports,
        moduleDoc: parsed.moduleDoc,
    };
}


