import React, { createContext, useContext, useState } from "react";

// Der Warenkorb lebt hier statt lokal in Kasse.jsx, damit er beim Wechsel zu
// "Karten" oder "Artikel" NICHT gelöscht wird — nur beim erfolgreichen
// Bezahlen oder durch den expliziten "Warenkorb leeren"-Button.
const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState([]);

  const addToCart = (article) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === article.id);
      if (existing) return prev.map((i) => i.id === article.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...article, qty: 1 }];
    });
  };

  const removeFromCart = (id) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (!existing) return prev;
      if (existing.qty === 1) return prev.filter((i) => i.id !== id);
      return prev.map((i) => i.id === id ? { ...i, qty: i.qty - 1 } : i);
    });
  };

  const clearCart = () => setCart([]);

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart muss innerhalb von <CartProvider> verwendet werden");
  return ctx;
}
