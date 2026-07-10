package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type TaskHandler struct {
	taskService service.TaskService
}

func NewTaskHandler(taskService service.TaskService) *TaskHandler {
	return &TaskHandler{taskService: taskService}
}

func (h *TaskHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/tasks")
	group.Use(middleware.AuthMiddleware())
	{
		group.POST("", middleware.RoleMiddleware("owner"), h.CreateTask)
		group.GET("", h.ListTasks)
		group.GET("/:id", h.GetTaskByID)
		group.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateTask)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteTask)
	}
}

func (h *TaskHandler) CreateTask(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	resp, err := h.taskService.CreateTask(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": resp})
}

func (h *TaskHandler) GetTaskByID(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	resp, err := h.taskService.GetTaskByID(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *TaskHandler) UpdateTask(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.taskService.UpdateTask(c.Request.Context(), userID, id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task updated successfully"})
}

func (h *TaskHandler) DeleteTask(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.taskService.DeleteTask(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task deleted successfully"})
}

func (h *TaskHandler) ListTasks(c *gin.Context) {
	userID := c.GetString("user_id")
	status := c.Query("status")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")
	frequency := c.Query("frequency")

	resp, err := h.taskService.ListTasks(c.Request.Context(), userID, status, dateFrom, dateTo, frequency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}
