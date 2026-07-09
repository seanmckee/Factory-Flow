# 🏭 Factory Flow

Factory Flow is a manufacturing simulation platform focused on modeling production systems and exploring how factories can optimize for their true objective: making money.

Inspired by Eliyahu M. Goldratt's _The Goal_, this project models production flow, throughput, work-in-process (WIP), inventory, and operational constraints to better understand how local decisions affect overall system performance.

Rather than optimizing individual machines, Factory Flow aims to simulate an entire manufacturing system where bottlenecks, variability, and flow determine overall profitability.

---

## Objectives

- Simulate the movement of work through a manufacturing facility.
- Model the relationship between throughput, inventory (WIP), and operational expense.
- Explore how bottlenecks limit system performance.
- Visualize the effects of statistical fluctuations and dependent events on production flow.
- Experiment with scheduling strategies, routing, staffing, and process improvements.

---

## Planned Features

### Manufacturing Model

- Work Orders
- Part Numbers
- Bills of Operations (Routings)
- Bills of Materials
- Inventory Management
- Multiple Production Lines
- Machine Downtime
- Operator Availability

### Simulation Engine

- Discrete-event production simulation
- Configurable processing times
- Statistical process variation
- Queue dynamics
- Bottleneck detection
- Throughput analysis
- Cycle time metrics
- WIP tracking

### Dashboard

- Live factory visualization
- Production metrics
- Queue lengths
- Utilization by work center
- Throughput trends
- Bottleneck reporting

### Backend

- Express REST API
- PostgreSQL
- Persistent production data
- Work order management

---

## Current Production Flow

```text
Raw Material
      │
      ▼
 Cutter
      │
      ▼
 Drill Press
      │
      ▼
 Deburr
      │
      ▼
 Inspection
      │
      ▼
 Packaging
      │
      ▼
 Finished Goods
```

---

## Technology

- React
- TypeScript
- Tailwind CSS
- Express
- PostgreSQL (planned)

---

## Long-Term Vision

The long-term objective is to build a simulation capable of modeling realistic manufacturing environments where routing, constraints, statistical variation, and operational policies can be evaluated before changes are made on the shop floor.

By combining production simulation with manufacturing principles, Factory Flow aims to provide insight into how improvements in flow—not simply machine utilization—affect overall factory performance.
