using System;

namespace PrismBackend.Services
{
    public class PaymentService
    {
        public bool ProcessPayment(decimal amount)
        {
            Console.WriteLine($"Processing ${amount} via PaymentService");
            return true;
        }
    }
}
