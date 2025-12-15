export type CodeEntityType = string;

export interface CodeEntity {
    entityType: CodeEntityType;
    name: string;
    qualifiedName: string;
    code: string;
    parentContext?: string;
    startLine: number;
    endLine: number;
    checksum: string;
    isExported: boolean;
    docstring?: string;
    parameters?: string;
    returnType?: string;
}

export interface CodeParsedFile {
    filepath: string;
    entities: CodeEntity[];
    imports: string[];
    moduleDoc?: string;
}


