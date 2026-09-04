export type WorkCenter = {
  id: number;
  name: string;
  /** machines; effective capacity is `min(capacity, operators)` */
  capacity: number;
  /** who stands at them — what the wage bill multiplies, and half the min */
  operators: number;
  /** cents per calendar day **one machine** costs whether or not it runs */
  standingCostCentsPerDay: number;
  /** per operator per staffed hour */
  wageCentsPerHour: number;
  /** what a capital action costs a run that froze these */
  machinePurchaseCents: number;
  machineSalvageCents: number;
  operatorHireCents: number;
};
