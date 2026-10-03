package com.prism.repository;

import com.prism.controller.OrderController;

public class OrderRepository {
    public String findOrderById(String orderId) {
        OrderController helper = new OrderController();
        return "Order " + orderId + " database payload";
    }
}
