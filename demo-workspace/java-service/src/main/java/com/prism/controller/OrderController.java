package com.prism.controller;

import com.prism.service.OrderService;

public class OrderController {
    private final OrderService orderService;

    public OrderController() {
        this.orderService = new OrderService();
    }

    public String processOrder(String orderId) {
        return orderService.handleOrder(orderId);
    }
}
