import { DataTypes } from "sequelize";
import { sequelize } from "../../../config/database";

/** Models SQL mínimos para exercitar os serviços reais sem inicializar Mongo/Stripe.
 * Todas as consultas, transações e travas passam pelo Sequelize e PostgreSQL reais.
 */
export function defineSqlFixture(
  table: string,
  fields: Record<string, string>,
) {
  const attributes: Record<string, any> = {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  };
  for (const [name, kind] of Object.entries(fields)) {
    attributes[name] = {
      type: (
        {
          int: DataTypes.INTEGER,
          date: DataTypes.DATE,
          bool: DataTypes.BOOLEAN,
          text: DataTypes.STRING,
          number: DataTypes.DECIMAL,
        } as any
      )[kind],
    };
  }
  if (attributes.payment_intent_id) attributes.payment_intent_id.unique = true;
  return sequelize.define(table, attributes, {
    tableName: table,
    timestamps: table === "appointment",
    underscored: true,
  });
}
