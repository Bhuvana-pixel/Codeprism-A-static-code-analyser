package com.prism.service;

import com.prism.repository.OrderRepository;

public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService() {
        this.orderRepository = new OrderRepository();
    }

    public String handleOrder(String orderId) {
        return orderRepository.findOrderById(orderId);
    }
}
