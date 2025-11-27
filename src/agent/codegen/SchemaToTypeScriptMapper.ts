import ts from 'typescript';
import type {
  NormalizedSchema,
  NormalizedObjectType,
  NormalizedArrayType,
  NormalizedEnumType,
} from './types.js';

export class SchemaToTypeScriptMapper {
  constructor(private readonly factory = ts.factory) {}

  public createTypeAliasDeclaration(
    name: string,
    schema?: NormalizedSchema,
  ): ts.TypeAliasDeclaration {
    return this.factory.createTypeAliasDeclaration(
      [this.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      this.factory.createIdentifier(name),
      undefined,
      this.typeNodeFromSchema(schema),
    );
  }

  public typeNodeFromSchema(schema?: NormalizedSchema): ts.TypeNode {
    if (!schema) {
      return this.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    }

    switch (schema.kind) {
      case 'string':
        return this.keywordType(ts.SyntaxKind.StringKeyword);
      case 'number':
      case 'integer':
        return this.keywordType(ts.SyntaxKind.NumberKeyword);
      case 'boolean':
        return this.keywordType(ts.SyntaxKind.BooleanKeyword);
      case 'enum':
        return this.enumTypeNode(schema);
      case 'array':
        return this.arrayTypeNode(schema);
      case 'object':
        return this.objectTypeNode(schema);
      default:
        return this.keywordType(ts.SyntaxKind.AnyKeyword);
    }
  }

  private keywordType(kind: ts.KeywordTypeSyntaxKind): ts.TypeNode {
    return this.factory.createKeywordTypeNode(kind);
  }

  private enumTypeNode(schema: NormalizedEnumType): ts.TypeNode {
    if (!schema.values.length) {
      return this.keywordType(ts.SyntaxKind.StringKeyword);
    }
    return this.factory.createUnionTypeNode(
      schema.values.map((value) =>
        this.factory.createLiteralTypeNode(this.factory.createStringLiteral(value)),
      ),
    );
  }

  private arrayTypeNode(schema: NormalizedArrayType): ts.TypeNode {
    return this.factory.createArrayTypeNode(this.typeNodeFromSchema(schema.items));
  }

  private objectTypeNode(schema: NormalizedObjectType): ts.TypeNode {
    const members: ts.TypeElement[] = schema.properties.map((property) =>
      this.factory.createPropertySignature(
        undefined,
        this.factory.createIdentifier(property.name),
        property.required ? undefined : this.factory.createToken(ts.SyntaxKind.QuestionToken),
        this.typeNodeFromSchema(property.schema),
      ),
    );

    if (schema.additionalProperties) {
      members.push(
        this.factory.createIndexSignature(
          undefined,
          [
            this.factory.createParameterDeclaration(
              undefined,
              undefined,
              this.factory.createIdentifier('key'),
              undefined,
              this.keywordType(ts.SyntaxKind.StringKeyword),
              undefined,
            ),
          ],
          this.keywordType(ts.SyntaxKind.AnyKeyword),
        ),
      );
    }

    return this.factory.createTypeLiteralNode(members);
  }
}
