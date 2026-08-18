export type WorkOrderAllocation = {
  id: number;
  salesOrderId: number;
  salesOrderNumber: string;
  quantity: number;
};

export type WorkOrder = {
  id: number;
  orderNumber: string;
  partId: number;
  routingId: number;
  quantity: number;
  status: string;
  partNumber: string;
  partName: string;
  allocations: WorkOrderAllocation[];
};
