import { parseTypescriptFile, ParsedFile, TypeScriptEntity } from "../astParser";
import type { ParserConfig } from "../../config/types";
import type { CodeParsedFile, CodeEntity } from "./types";

export function parseTypescriptCodeFile(
    filepath: string,
    content: string,
    config?: ParserConfig
): CodeParsedFile {
    const parsed: ParsedFile = parseTypescriptFile(filepath, content, config);

    const entities: CodeEntity[] = parsed.entities.map((e: TypeScriptEntity) => ({
        entityType: e.entityType,
        name: e.name,
        qualifiedName: e.qualifiedName,
        code: e.code,
        parentContext: e.parentContext,
        startLine: e.startLine,
        endLine: e.endLine,
        checksum: e.checksum,
        isExported: e.isExported,
        docstring: e.jsDoc,
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


