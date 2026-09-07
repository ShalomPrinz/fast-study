# כותרת ראשית

טקסט עברי רגיל עם **מודגש**, *נטוי*, ~~מחוק~~ ו-`קוד בשורה`, ומונח באנגלית: gradient descent.

## כותרת משנה

::: definition
הגדרה: פונקציה קמורה היא פונקציה שכל מיתר שלה נמצא מעל הגרף.
:::

::: warning
אזהרה: שיטה זו לא מתכנסת עבור $\alpha$ גדול מדי.
:::

::: insight
תובנה: אפשר לראות את זה כהטלה אורתוגונלית.
:::

נוסחה בשורה $e^{i\pi} + 1 = 0$ ונוסחה מוצגת:

$$\sum_{i=1}^{n} \frac{x_i - \mu}{\sigma} \le \int_0^\infty e^{-t^2}\,dt \quad \forall x \in \mathbb{R}^n$$

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix} \otimes \aleph_0 \Rightarrow \bigcup_{k} A_k$$

| עמודה א | עמודה ב | Value |
| ------- | ------- | ----: |
| ערך     | ערך שני | 3.14  |
| שורה    | נוספת   | 42    |

```python
def gradient_descent(x0, alpha=0.01, eps=1e-8):
    """A very long line intended to exceed the text width so that fvextra breaklines has something real to break, with symbols like <=> and ||."""
    x = x0
    while abs(grad(x)) > eps:
        x -= alpha * grad(x)
    return x
```

```
plain fence with no language, so no highlighting macros apply
```

1. פריט ממוספר
   - תת-פריט
   - עוד אחד
2. פריט שני

> ציטוט מוסגר עם הערת שוליים.[^1]

[^1]: זו הערת השוליים.

קישור ל[אתר](https://example.com) וכתובת גולמית <https://example.com/very/long/path/that/should/wrap>.

---

Term
:   הגדרה של המונח

H~2~O ו-x^2^ .

![תרשים](probe.png)
