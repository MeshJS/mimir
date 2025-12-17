import { parseRustFile, ParsedRustFile, RustEntity } from "../rustAstParser";
import type { CodeParsedFile, CodeEntity } from "./types";

export async function parseRustCodeFile(
    filepath: string,
    content: string
): Promise<CodeParsedFile> {
    const parsed: ParsedRustFile = await parseRustFile(filepath, content);

    const entities: CodeEntity[] = parsed.entities.map((e: RustEntity) => ({
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

