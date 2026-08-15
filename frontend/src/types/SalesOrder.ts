export type Allocation = {
    id: number;
    salesOrderId: number;
    workOrderId: number;
    quantity: number;
  };
  
  export type SalesOrder = {
    id: number;
    partId: number;
    quantity: number;
    unitPriceCents: number;
    orderNumber: string;
    allocations: Allocation[];
  };