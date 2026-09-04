export type WorkCenter = {
  id: number;
  name: string;
  capacity: number;
  /** cents per calendar day the centre costs whether or not it runs */
  standingCostCentsPerDay: number;
  /** per operator per staffed hour; operators = machines until 6E */
  wageCentsPerHour: number;
};
