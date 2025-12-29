import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

type StateType = {
  pagination: {
    page: number;
    perPage: number;
    totalPages: number;
  };
  filter: {
    field: string;
    operator: string;
    value: string;
  };
};

type ActionsType = {
  pagination: {
    setPagination: (page: number, perPage: number) => void;
    setPaginationLimit: (totalPages: number) => void;
  };
  filter: {
    setFilter(field: string, operator: string, value: string): void;
    setField(field: string): void;
    setValue(value: string): void;
    setOperator(operator: string): void;
    reset(): void;
  };
};

export const useRouterStore = create<StateType & ActionsType>()(
  immer((set) => ({
    pagination: {
      page: 1,
      perPage: 10,
      totalPages: -1,
      setPaginationLimit(totalPages) {
        set((state) => {
          state.pagination.totalPages = totalPages;
        });
      },
      setPagination(page, perPage) {
        if (page < 1) page = 1;
        if (perPage < 5) perPage = 5;
        if (perPage > 50) perPage = 50;

        set((state) => {
          state.pagination.page = page;
          state.pagination.perPage = perPage;
        });
      },
    },
    filter: {
      field: "name",
      operator: "eq",
      value: "",
      setField(field) {
        set((old) => {
          old.filter.field = field;
          old.filter.value = "";
        });
      },
      setFilter(field, operator, value) {
        set((old) => {
          old.filter.field = field;
          old.filter.operator = operator;
          old.filter.value = value;
        });
      },
      setOperator(operator) {
        set((old) => {
          old.filter.operator = operator;
        });
      },
      setValue(value) {
        set((old) => {
          old.filter.value = value;
        });
      },
      reset() {
        set((old) => {
          old.filter.field = "name";
          old.filter.operator = "eq";
          old.filter.value = "";
        });
      },
    },
  }))
);

export const useRouterPagination = () =>
  useRouterStore((state) => state.pagination);

export const useRouterFilter = () => useRouterStore((state) => state.filter);
